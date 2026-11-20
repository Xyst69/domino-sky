// Server-only: the AI dispatcher. The engine runs here again, so the browser cannot forge facts.
import { FunctionCallingConfigMode, GoogleGenAI, type Content, type FunctionCall } from "@google/genai";
import {
  NETWORK,
  ENGINE_VERSION,
  PRIORITY_LABEL,
  actionId,
  buildFacts,
  checkPlan,
  entitySets,
  fmt,
  normaliseClosures,
  offlineExplanation,
  parseActionId,
  pickPlan,
  planId,
  searchRecovery,
  simulate,
  validateSegments,
  type Action,
  type Closure,
  type Facts,
  type Metrics,
  type Plan,
  type Priority,
  type Segment,
  type SimResult,
} from "@/engine";
import type { DispatchRequest, DispatchResponse, TrailStep } from "./contract";
import { DISPATCHER_SYSTEM } from "./prompts";

const MAX_SIMULATE_CALLS = 3;
const MAX_REPAIRS = 1;

interface Prepared {
  closures: Closure[];
  priority: Priority;
  closureRes: SimResult;
  frontier: Plan[];
  candidates: Action[];
  defaultPlan: Plan;
  defaultRes: SimResult;
  relevant: Set<string>;
  evaluated: number;
}

function prepare(closures: Closure[], priority: Priority): Prepared {
  const search = searchRecovery(NETWORK, closures);
  const defaultPlan = pickPlan(search.frontier, priority);
  const defaultRes = simulate(NETWORK, { closures, actions: defaultPlan.actions });
  const relevant = new Set<string>();
  for (const p of search.frontier.slice(0, 15)) {
    const r = simulate(NETWORK, { closures, actions: p.actions });
    for (const s of Object.values(r.flights)) if (s.status !== "on_time" || s.absorbed > 0) relevant.add(s.id);
  }
  return {
    closures,
    priority,
    closureRes: search.base,
    frontier: search.frontier,
    candidates: search.candidates,
    defaultPlan,
    defaultRes,
    relevant,
    evaluated: search.evaluated,
  };
}

function factsFor(p: Prepared, planActions: Action[]): { facts: Facts; planRes: SimResult } {
  const planRes = simulate(NETWORK, { closures: p.closures, actions: planActions });
  const facts = buildFacts(NETWORK, p.closures, { closure: p.closureRes, plan: planRes, default: p.defaultRes }, p.relevant);
  return { facts, planRes };
}

function offline(p: Prepared, req: DispatchRequest, reason: string, trail: TrailStep[] = []): DispatchResponse {
  const { facts } = factsFor(p, p.defaultPlan.actions);
  return {
    engineVersion: ENGINE_VERSION,
    scenarioHash: req.scenarioHash,
    source: "offline",
    reason,
    planActions: p.defaultPlan.actions.map(actionId),
    defaultActions: p.defaultPlan.actions.map(actionId),
    segments: offlineExplanation(NETWORK, p.defaultPlan, p.priority),
    trail,
    facts,
    frontierSize: p.frontier.length,
    evaluated: p.evaluated,
  };
}

const METRIC_KEYS: (keyof Metrics)[] = ["strandedPax", "cancelledFlights", "lateFlights", "paxDelayMinutes", "brokenConnections", "crewBreaches", "sparesUsed", "outOfPosition"];
const brief = (m: Metrics) => Object.fromEntries(METRIC_KEYS.map((k) => [k, m[k]]));

function describeCandidate(a: Action): string {
  const f = (id: string) => NETWORK.flights.find((x) => x.id === id)!;
  switch (a.kind) {
    case "swap": {
      const x = f(a.flight);
      return `Spare ${a.spare} flies ${a.flight} ${x.origin}-${x.destination} (${fmt(x.dep)}) and the rest of ${x.tail}'s day; ${x.tail} stops at ${x.origin}.`;
    }
    case "cancelPair": {
      const o = f(a.out);
      return `Cancel ${a.out} ${o.origin}-${o.destination} and ${a.back} back, so ${o.tail} stays on time afterwards.`;
    }
    case "hold": {
      const c = NETWORK.connections.find((x) => x.id === a.connection)!;
      return `Hold ${c.to} (up to an hour) for ${c.passengers} passengers connecting from ${c.from} at ${c.airport}.`;
    }
  }
}

function situation(p: Prepared, factKeys: Facts): string {
  const hit = Object.values(p.closureRes.flights)
    .filter((s) => s.status !== "on_time")
    .map((s) => {
      const f = NETWORK.flights.find((x) => x.id === s.id)!;
      return { flight: s.id, aircraft: s.tail, crew: s.crew, route: `${f.origin}-${f.destination}`, status: s.status, delayMin: s.delay, cause: s.cause?.kind, causedBy: s.cause?.sourceFlight ?? s.cause?.airport };
    });
  const broken = Object.values(p.closureRes.connections)
    .filter((c) => !c.made)
    .map((c) => {
      const cx = NETWORK.connections.find((x) => x.id === c.id)!;
      return { connection: c.id, from: cx.from, to: cx.to, passengers: cx.passengers, reason: c.reason };
    });
  return JSON.stringify(
    {
      storms: p.closures.map((c) => ({ airport: c.airport, closed: `${fmt(c.start)}-${fmt(c.end)}` })),
      operatorPriority: PRIORITY_LABEL[p.priority],
      resultWithoutRecovery: brief(p.closureRes.metrics),
      affectedFlights: hit,
      brokenConnections: broken,
      candidateActions: p.candidates.map((a) => ({ id: actionId(a), effect: describeCandidate(a) })),
      enginesBestPlans: p.frontier.slice(0, 12).map((pl) => ({ plan: pl.actions.map(actionId), results: brief(pl.metrics) })),
      engineDefaultPlanForThisPriority: p.defaultPlan.actions.map(actionId),
      FACT_KEYS: Object.fromEntries(Object.entries(factKeys).map(([k, v]) => [k, v.label])),
    },
    null,
    1,
  );
}

function declarations(actionIds: string[], factKeys: string[]) {
  const actionsSchema = { type: "array", items: { type: "string", enum: actionIds.length ? actionIds : ["NONE"] } };
  return [
    {
      name: "simulate",
      description: "Run the deterministic engine on a combination of candidate actions and return the exact results, or why the combination is impossible.",
      parametersJsonSchema: { type: "object", properties: { actions: actionsSchema }, required: ["actions"] },
    },
    {
      name: "submit_plan",
      description: "Submit the final recovery plan and its explanation. Call exactly once, at the end.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          actions: actionsSchema,
          explanation: {
            type: "array",
            items: {
              type: "object",
              properties: {
                k: { type: "string", enum: ["text", "fact", "entity", "compare"] },
                text: { type: "string", description: "Only for k=text. No digits, no number words." },
                key: { type: "string", enum: factKeys, description: "Only for k=fact." },
                type: { type: "string", enum: ["flight", "aircraft", "crew", "airport", "connection"], description: "Only for k=entity." },
                id: { type: "string", description: "Only for k=entity." },
                left: { type: "string", enum: factKeys, description: "Only for k=compare." },
                op: { type: "string", enum: ["lt", "gt", "eq"], description: "Only for k=compare." },
                right: { type: "string", enum: factKeys, description: "Only for k=compare." },
              },
              required: ["k"],
            },
          },
        },
        required: ["actions", "explanation"],
      },
    },
  ];
}

function toSegments(raw: unknown): Segment[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s: Record<string, unknown>) => {
    switch (s.k) {
      case "text":
        return { k: "text", text: String(s.text ?? "") };
      case "fact":
        return { k: "fact", key: String(s.key ?? "") };
      case "entity":
        return { k: "entity", type: s.type as never, id: String(s.id ?? "") };
      case "compare":
        return { k: "compare", left: String(s.left ?? ""), op: (s.op as "lt") ?? "lt", right: String(s.right ?? "") };
      default:
        return { k: String(s.k) } as unknown as Segment; // rejected by the validator as an unknown kind
    }
  }) as Segment[];
}

function parseActions(raw: unknown, allowed: Set<string>): { actions: Action[]; error?: string } {
  if (!Array.isArray(raw)) return { actions: [], error: "actions must be a list of action IDs" };
  const actions: Action[] = [];
  for (const id of raw) {
    if (id === "NONE") continue;
    if (typeof id !== "string" || !allowed.has(id)) return { actions: [], error: `Unknown action ID ${String(id)}` };
    actions.push(parseActionId(id)!);
  }
  return { actions };
}

export async function dispatch(req: DispatchRequest, opts: { apiKey?: string; model: string; timeoutMs: number; enabled: boolean }): Promise<DispatchResponse> {
  const closures = normaliseClosures(req.closures);
  const p = prepare(closures, req.priority);
  if (!opts.enabled) return offline(p, req, "The AI dispatcher is switched off on this deployment.");
  if (!opts.apiKey) return offline(p, req, "No Gemini API key is configured on the server.");
  if (p.candidates.length === 0) return offline(p, req, "The storm left nothing a recovery action could improve.");

  const allowed = new Set(p.candidates.map(actionId));
  // Fact keys the AI may cite: built from the default plan; plan.* keys are recomputed for its own plan.
  const provisional = factsFor(p, p.defaultPlan.actions).facts;
  const factKeys = Object.keys(provisional);
  const ents = entitySets(NETWORK);
  const trail: TrailStep[] = [];
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

  const contents: Content[] = [{ role: "user", parts: [{ text: situation(p, provisional) }] }];
  let simulateCalls = 0;
  let repairs = 0;

  try {
    for (let turn = 0; turn < MAX_SIMULATE_CALLS + MAX_REPAIRS + 2; turn++) {
      const canSimulate = simulateCalls < MAX_SIMULATE_CALLS;
      const res = await ai.models.generateContent({
        model: opts.model,
        contents,
        config: {
          abortSignal: controller.signal,
          systemInstruction: DISPATCHER_SYSTEM,
          tools: [{ functionDeclarations: declarations([...allowed], factKeys) }],
          toolConfig: {
            functionCallingConfig: {
              mode: FunctionCallingConfigMode.ANY,
              allowedFunctionNames: canSimulate ? ["simulate", "submit_plan"] : ["submit_plan"],
            },
          },
        },
      });
      const modelTurn = res.candidates?.[0]?.content;
      const calls: FunctionCall[] = res.functionCalls ?? [];
      if (!modelTurn || calls.length === 0) return offline(p, req, "The AI returned no plan.", trail);
      contents.push(modelTurn); // keeps any thought signatures the model needs on the next turn

      const responses: Content = { role: "user", parts: [] };
      for (const call of calls) {
        if (call.name === "simulate") {
          simulateCalls++;
          const { actions, error } = parseActions(call.args?.actions, allowed);
          let output: Record<string, unknown>;
          if (error) output = { error };
          else {
            const feas = checkPlan(NETWORK, actions);
            if (!feas.ok) output = { error: feas.reason };
            else output = { results: brief(simulate(NETWORK, { closures, actions }).metrics) };
          }
          trail.push({ actions: actions.map(actionId), metrics: output.results as Metrics | undefined, error: output.error as string | undefined });
          responses.parts!.push({ functionResponse: { id: call.id, name: "simulate", response: output } });
        } else if (call.name === "submit_plan") {
          const { actions, error } = parseActions(call.args?.actions, allowed);
          const feas = error ? { ok: false as const, reason: error } : checkPlan(NETWORK, actions);
          const segments = toSegments(call.args?.explanation);
          let errors: string[] = [];
          let facts: Facts | undefined;
          if (!feas.ok) errors = [feas.reason];
          else {
            facts = factsFor(p, actions).facts;
            const v = validateSegments(segments, facts, ents);
            if (!v.ok) errors = v.errors;
          }
          if (errors.length === 0 && facts) {
            return {
              engineVersion: ENGINE_VERSION,
              scenarioHash: req.scenarioHash,
              source: "ai",
              model: opts.model,
              planActions: actions.map(actionId),
              defaultActions: p.defaultPlan.actions.map(actionId),
              segments,
              trail,
              facts,
              frontierSize: p.frontier.length,
              evaluated: p.evaluated,
            };
          }
          if (repairs >= MAX_REPAIRS) return offline(p, req, `The AI's explanation failed the number check twice (${errors[0]}).`, trail);
          repairs++;
          responses.parts!.push({
            functionResponse: { id: call.id, name: "submit_plan", response: { error: `Rejected. Fix these problems and call submit_plan again: ${errors.join(" ")}` } },
          });
        }
      }
      contents.push(responses);
    }
    return offline(p, req, "The AI did not finish within its step budget.", trail);
  } catch (e) {
    const msg = controller.signal.aborted ? "The AI took too long to answer." : `The AI call failed (${(e as Error).message.slice(0, 120)}).`;
    return offline(p, req, msg, trail);
  } finally {
    clearTimeout(timer);
  }
}

export { planId };
