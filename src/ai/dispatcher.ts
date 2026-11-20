// Server-only: the AI dispatcher. The engine runs here again, so the browser cannot forge facts.
import { FunctionCallingConfigMode, GoogleGenAI, ThinkingLevel, type Content, type FunctionCall, type GenerateContentConfig } from "@google/genai";
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
  scenarioHash,
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

export const MAX_SIMULATE_CALLS = 3;
const MAX_REPAIRS = 1;

/** Fixed, user-facing reasons for falling back. Never contains model text. */
export const OFFLINE_REASON = {
  disabled: "The AI dispatcher is switched off on this deployment, so the engine's own best plan is shown.",
  noKey: "The AI dispatcher is not connected on this deployment, so the engine's own best plan is shown.",
  nothingToDo: "No recovery move can improve this situation, so there was nothing for the AI to weigh.",
  noPlan: "The AI did not return a plan, so the engine's own best plan is shown.",
  failedCheck: "The AI's explanation failed the number check twice, so the engine's own best plan is shown.",
  budget: "The AI did not finish in time, so the engine's own best plan is shown.",
  timeout: "The AI took too long to answer, so the engine's own best plan is shown.",
  error: "The AI service could not be reached, so the engine's own best plan is shown.",
} as const;

export interface DispatchOptions {
  apiKey?: string;
  model: string;
  timeoutMs: number;
  enabled: boolean;
  thinkingLevel?: string;
  client?: Pick<GoogleGenAI, "models">; // injectable for tests
}

interface Prepared {
  closures: Closure[];
  priority: Priority;
  note: string;
  hash: string;
  closureRes: SimResult;
  frontier: Plan[];
  candidates: Action[];
  defaultPlan: Plan;
  defaultRes: SimResult;
  relevant: Set<string>;
  evaluated: number;
}

function prepare(closures: Closure[], priority: Priority, note: string): Prepared {
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
    note,
    hash: scenarioHash(closures, priority, note),
    closureRes: search.base,
    frontier: search.frontier,
    candidates: search.candidates,
    defaultPlan,
    defaultRes,
    relevant,
    evaluated: search.evaluated,
  };
}

function factsFor(p: Prepared, planActions: Action[]): Facts {
  const planRes = simulate(NETWORK, { closures: p.closures, actions: planActions });
  return buildFacts(NETWORK, p.closures, { closure: p.closureRes, plan: planRes, default: p.defaultRes }, p.relevant);
}

function base(p: Prepared): Omit<DispatchResponse, "source" | "planActions" | "segments" | "trail" | "facts"> {
  return {
    engineVersion: ENGINE_VERSION,
    scenarioHash: p.hash,
    defaultActions: p.defaultPlan.actions.map(actionId),
    frontierSize: p.frontier.length,
    evaluated: p.evaluated,
  };
}

function offline(p: Prepared, reason: string, trail: TrailStep[] = []): DispatchResponse {
  return {
    ...base(p),
    source: "offline",
    reason,
    planActions: p.defaultPlan.actions.map(actionId),
    segments: offlineExplanation(NETWORK, p.defaultPlan, p.priority),
    trail,
    facts: factsFor(p, p.defaultPlan.actions),
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
      return `Cancel ${a.out} ${o.origin}-${o.destination} and ${a.back} back, so ${o.tail} runs on time afterwards.`;
    }
    case "hold": {
      const c = NETWORK.connections.find((x) => x.id === a.connection)!;
      return `Hold ${c.to} (up to an hour) for ${c.passengers} passengers connecting from ${c.from} at ${c.airport}.`;
    }
  }
}

function situation(p: Prepared, facts: Facts): string {
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
      operatorNote: p.note ? { untrustedText: p.note } : null,
      resultWithoutRecovery: brief(p.closureRes.metrics),
      affectedFlights: hit,
      brokenConnections: broken,
      candidateActions: p.candidates.map((a) => ({ id: actionId(a), effect: describeCandidate(a) })),
      enginesBestPlans: p.frontier.slice(0, 12).map((pl) => ({ plan: pl.actions.map(actionId), results: brief(pl.metrics) })),
      engineDefaultPlanForThisPriority: p.defaultPlan.actions.map(actionId),
      FACT_KEYS: Object.fromEntries(Object.entries(facts).map(([k, v]) => [k, v.label])),
    },
    null,
    1,
  );
}

function declarations(actionIds: string[]) {
  // Fact keys are listed in the prompt and checked by the validator, not enumerated in the schema:
  // several hundred enum values would risk exceeding the model's schema limits.
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
                text: { type: "string", description: "Only for k=text. No digits, numerals or number words." },
                key: { type: "string", description: "Only for k=fact. A key from FACT_KEYS." },
                type: { type: "string", enum: ["flight", "aircraft", "crew", "airport", "connection"], description: "Only for k=entity." },
                id: { type: "string", description: "Only for k=entity." },
                left: { type: "string", description: "Only for k=compare. A key from FACT_KEYS." },
                op: { type: "string", enum: ["lt", "gt", "eq"], description: "Only for k=compare." },
                right: { type: "string", description: "Only for k=compare. A key from FACT_KEYS." },
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
  return raw.slice(0, 64).map((s: Record<string, unknown>) => {
    switch (s?.k) {
      case "text":
        return { k: "text", text: String(s.text ?? "") };
      case "fact":
        return { k: "fact", key: String(s.key ?? "") };
      case "entity":
        return { k: "entity", type: s.type as never, id: String(s.id ?? "") };
      case "compare":
        return { k: "compare", left: String(s.left ?? ""), op: (s.op as "lt") ?? "lt", right: String(s.right ?? "") };
      default:
        return { k: String(s?.k) } as unknown as Segment; // rejected by the validator as an unknown kind
    }
  }) as Segment[];
}

function parseActions(raw: unknown, allowed: Set<string>): Action[] | null {
  if (!Array.isArray(raw)) return null;
  const actions: Action[] = [];
  for (const id of raw) {
    if (id === "NONE") continue;
    if (typeof id !== "string" || !allowed.has(id)) return null;
    actions.push(parseActionId(id)!);
  }
  return actions;
}

function generationConfig(opts: DispatchOptions, signal: AbortSignal): GenerateContentConfig {
  const level = opts.thinkingLevel?.toUpperCase();
  // thinkingLevel is only accepted by Gemini 3 and later; older models reject it.
  const supportsLevel = /gemini-(3|[4-9])/.test(opts.model);
  const valid = supportsLevel && level && (Object.values(ThinkingLevel) as string[]).includes(level) ? (level as ThinkingLevel) : undefined;
  return {
    abortSignal: signal,
    systemInstruction: DISPATCHER_SYSTEM,
    maxOutputTokens: 4096,
    ...(valid ? { thinkingConfig: { thinkingLevel: valid } } : {}),
  };
}

export async function dispatch(req: DispatchRequest, opts: DispatchOptions): Promise<DispatchResponse> {
  const closures = normaliseClosures(req.closures);
  const p = prepare(closures, req.priority, req.note ?? "");
  if (!opts.enabled) return offline(p, OFFLINE_REASON.disabled);
  if (!opts.apiKey && !opts.client) return offline(p, OFFLINE_REASON.noKey);
  if (p.candidates.length === 0) return offline(p, OFFLINE_REASON.nothingToDo);

  const allowed = new Set(p.candidates.map(actionId));
  const provisional = factsFor(p, p.defaultPlan.actions);
  const ents = entitySets(NETWORK);
  const trail: TrailStep[] = [];
  const ai = opts.client ?? new GoogleGenAI({ apiKey: opts.apiKey });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const tools = [{ functionDeclarations: declarations([...allowed]) }];

  const contents: Content[] = [{ role: "user", parts: [{ text: situation(p, provisional) }] }];
  let simulateCalls = 0;
  let repairs = 0;

  try {
    for (let turn = 0; turn < MAX_SIMULATE_CALLS + MAX_REPAIRS + 2; turn++) {
      const res = await ai.models.generateContent({
        model: opts.model,
        contents,
        config: {
          ...generationConfig(opts, controller.signal),
          tools,
          toolConfig: {
            functionCallingConfig: {
              mode: FunctionCallingConfigMode.ANY,
              allowedFunctionNames: simulateCalls < MAX_SIMULATE_CALLS ? ["simulate", "submit_plan"] : ["submit_plan"],
            },
          },
        },
      });
      const modelTurn = res.candidates?.[0]?.content;
      const calls: FunctionCall[] = res.functionCalls ?? [];
      if (!modelTurn || calls.length === 0) return offline(p, OFFLINE_REASON.noPlan, trail);
      contents.push(modelTurn); // keeps any thought signatures the model needs on the next turn

      // Every function call gets exactly one response part, in order.
      const responses: Content = { role: "user", parts: [] };
      for (const call of calls) {
        const reply = (response: Record<string, unknown>) =>
          responses.parts!.push({ functionResponse: { id: call.id, name: call.name, response } });

        if (call.name === "simulate") {
          if (simulateCalls >= MAX_SIMULATE_CALLS) {
            reply({ error: "Simulation budget used up. Call submit_plan now." });
            continue;
          }
          simulateCalls++;
          const actions = parseActions(call.args?.actions, allowed);
          if (!actions) {
            trail.push({ actions: [], error: "Not a valid list of candidate actions." });
            reply({ error: "Use only action IDs from candidateActions." });
            continue;
          }
          const feas = checkPlan(NETWORK, actions);
          if (!feas.ok) {
            trail.push({ actions: actions.map(actionId), error: feas.reason });
            reply({ error: feas.reason });
            continue;
          }
          const metrics = simulate(NETWORK, { closures, actions }).metrics;
          trail.push({ actions: actions.map(actionId), metrics });
          reply({ results: brief(metrics) });
        } else if (call.name === "submit_plan") {
          const actions = parseActions(call.args?.actions, allowed);
          const segments = toSegments(call.args?.explanation);
          let errors: string[];
          let facts: Facts | undefined;
          if (!actions) errors = ["Use only action IDs from candidateActions."];
          else {
            const feas = checkPlan(NETWORK, actions);
            if (!feas.ok) errors = [feas.reason];
            else {
              facts = factsFor(p, actions);
              const v = validateSegments(segments, facts, ents);
              errors = v.ok ? [] : v.errors;
            }
          }
          if (errors.length === 0 && actions && facts) {
            return { ...base(p), source: "ai", model: opts.model, planActions: actions.map(actionId), segments, trail, facts };
          }
          console.warn("[dispatch] submit_plan rejected:", errors.join(" | "));
          if (repairs >= MAX_REPAIRS) return offline(p, OFFLINE_REASON.failedCheck, trail);
          repairs++;
          reply({ error: `Rejected. Fix these problems and call submit_plan again: ${errors.join(" ")}` });
        } else {
          reply({ error: "Unknown function. Use simulate or submit_plan." });
        }
      }
      contents.push(responses);
    }
    return offline(p, OFFLINE_REASON.budget, trail);
  } catch (e) {
    if (!controller.signal.aborted) console.warn("[dispatch] AI call failed:", (e as Error).message);
    return offline(p, controller.signal.aborted ? OFFLINE_REASON.timeout : OFFLINE_REASON.error, trail);
  } finally {
    clearTimeout(timer);
  }
}
