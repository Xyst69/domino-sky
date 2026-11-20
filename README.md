# Domino Sky

Close an airport for a time window and watch the delay spread through one airline's day:
aircraft arrive late so their next flights leave late, crews run past their 600-minute duty
limit so flights are cancelled, and passengers miss connections. Every late flight can be
traced back to the storm. A dispatcher (Google Gemini, with an offline fallback) recommends
recovery actions, and the app shows the network before and after.

**The hard rule — every number the AI states must match the app's own calculation — holds by
construction:** the AI never writes a digit. It returns typed segments that reference values
by key; the deterministic engine supplies every number, and the browser re-computes them
independently.

## Airline operations control

The chosen vertical is **Domino Sky — Flight Disruption Cascade & Recovery Simulator**.
The operator is an airline dispatcher deciding which passengers, crews and aircraft to protect during a closure.
For a short walkthrough, choose **Mumbai afternoon storm**, inspect **DS0304**, then apply the Delhi spare.
Stranded passengers fall from **167 to 0**. **Undo** restores the disrupted schedule.

[Open the simulator](https://domino-sky-eight.vercel.app/)

## Run it

```bash
npm ci
cp .env.example .env.local   # add GEMINI_API_KEY (optional — the app works offline without it)
npm run dev                  # http://localhost:3000
npm test                     # simulation, recovery, explanations, AI and HTTP routes
npm run typecheck
npm run bench                # recovery search across five scenarios
npm run build
```

Deploy on Vercel: import the repository, set `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`,
`GEMINI_THINKING_LEVEL`, `AI_ENABLED`) in Project Settings → Environment Variables, deploy. No
database or other service.

**Before a demo:** open the deployed site, run each preset and one unrehearsed storm (for example
Hyderabad for 75 minutes), and press "Ask the dispatcher". The badge must read "Chosen by Gemini".
If it reads "Engine's best plan (AI unavailable)", check the key, the model ID (it must support
function calling) and the key's rate limits. Setting `GEMINI_THINKING_LEVEL=LOW` keeps answers fast
on models that think by default.

## What is where

| Path | What it is |
| --- | --- |
| `datsett.json` | The organisers' dataset, unchanged. Validated on load (legs join up, block times match). |
| `src/engine/` | The deterministic engine. Pure TypeScript: no React, no `Date`, no randomness. Runs in the browser and on the server. |
| `src/engine/simulate.ts` | Closure rules, aircraft rotation with buffer absorption, crew duty and cause records. |
| `src/engine/metrics.ts` | Connection outcomes, passenger accounting, aircraft positioning and capacity checks. |
| `src/engine/recovery.ts` | Recovery actions as patches with stable IDs, conflict checker, exhaustive search, Pareto set, priority orders. |
| `src/engine/explain.ts` | The fact registry (every number the AI may cite), typed explanation segments and the validator. |
| `src/engine/chain.ts` | "Why is this flight late?" — walks recorded causes back to the storm. |
| `src/ai/` | Gemini dispatcher and crisis compiler (server only), versioned prompts, rule-based fallbacks, shared request/response contract. |
| `app/api/dispatch`, `app/api/crisis` | The two API routes. Validate input, rate-limit, re-run the engine on the server. |
| `src/ui/` | React components: map, domino board, clock, panels. |
| `docs/concepts_brief.md` | The design brief, including the judging-criteria mapping and every decision taken. |

## How the simulation works

All times are whole minutes since 00:00 IST.

- **Closures** are half-open windows `[start, end)`. No departures from a closed airport. A
  flight that would land at a closed airport waits at its origin and lands at reopening, unless
  it was already airborne when the closure began. Several closures can run at once.
- **Aircraft rotation:** departure = max(scheduled departure, previous arrival + 30 min,
  reopening if needed). Slack in the schedule absorbs delay first; the app shows how much each
  turnaround absorbed.
- **Crew duty** runs from report time to the landing of the crew's last flight, using revised
  times after delays, and may not exceed 600 minutes. The dataset note says "scheduled arrival";
  read literally, delays could never break a crew's limit, contradicting the problem statement,
  so the revised schedule is used (stated in the app). A flight that would end past the limit is
  cancelled with the crew's later flights.
- **Passengers:** a flight's `pax` already includes its connecting passengers (DS0304 carries
  167 including CX19's 14; counting them again would exceed 180 seats). Stranded = passengers on
  cancelled flights − connecting passengers counted on two cancelled flights + connecting
  passengers who miss a connection between two flights that both operated.
- **Airport capacity** never binds on the supplied timetable. The engine checks each airport's
  total scheduled movements against its hourly limit once per search. If the daily total could
  exceed that limit, it checks actual movements in rolling 60-minute windows for each plan.

### Recovery search performance

Each search indexes the timetable once. It retains the best trade-offs as it evaluates plans,
discards dominated candidates immediately and reuses single-action metrics for the recovery controls.
The benchmark runs all four presets plus simultaneous DEL, BOM, HYD and BLR closures from 09:00 to
13:30. On the development machine with Node 24.19, one batch took **66.5 ms before** and
**28.4 ms after** the change (median of ten measured batches after two warmups).
The benchmark command above exercises the same workload. Timings vary by machine.

## Recovery and the AI's role

Actions: swap a spare aircraft (with its standby crew) onto a flight leaving the spare's base
and the rest of that aircraft's day; cancel an out-and-back pair; hold a departure (up to 60
min) for connecting passengers. The engine tries every single action, every compatible pair
and triples of the strongest singles, and keeps the **Pareto set**: plans no other plan beats
on every measure (stranded passengers, cancellations, passenger-minutes of delay, crew
breaches, spares used, aircraft away from their overnight airport).

A single score would make the AI redundant, so there is none. The operator states a priority and
may add a note the engine's sort cannot express ("keep the Bengaluru spare free for the
evening", "protect the Kolkata connection"). Gemini chooses among the Pareto plans with that in
mind, may test its own combinations through a `simulate` tool (at most three calls, enforced per
call), and explains the trade-off. The screen shows the engine's default pick next to the
dispatcher's choice, says whether they differ, and lists the plans the AI tested. The note is
passed to the model as untrusted data, never as an instruction.

### The number guarantee

1. The server re-runs the engine from the closure parameters. Facts sent by a browser are never trusted.
2. The AI's `submit_plan` call must use action IDs from an enumerated list and fact keys from
   the list in its prompt.
3. `validateSegments` rejects any text segment containing a Unicode number (`\p{N}`: digits in
   every script, superscripts, fractions, numeral signs), an upper-case Roman numeral, a number
   word ("forty", "half", "third", "both", "million"…), or a comparative word ("fewer", "saves")
   without a checked compare segment; it also rejects unknown keys or IDs, false comparisons,
   comparisons between different kinds of number, and over-long explanations. One repair
   attempt, then the engine's own plan is shown, clearly labelled.
4. The engine re-simulates the chosen plan and fills every number in; the UI renders segments
   as text nodes, never as HTML, and writes each comparison's direction itself.
5. No free text from the model reaches the screen outside a validated explanation: fallback
   reasons and crisis notes are fixed wording.
6. The browser recomputes every cited fact with its own copy of the engine and shows whether they match.
7. The server recomputes the scenario code; the browser drops any answer that belongs to a storm
   the judge has since changed.

## The judges' four live tests

| Test | Where it is proven |
| --- | --- |
| Buffer absorption (20 vs 110 min) | `engine.test.ts` "buffer absorption"; on screen, absorbed delay is marked on each bar. |
| Hub vs spoke (GAU, TRV) | `engine.test.ts` "hub vs spoke". |
| Live recovery delta + exact undo | Recovery moves and Apply in the dispatcher panel; Undo restores the previous snapshot; `engine.test.ts` determinism test. |
| Grounded AI on an unrehearsed storm | The AI only sees and cites entities and facts from the current scenario's engine run (see above). |

## Presets

Chosen by scanning every airport and start time for real trade-offs; numbers are frozen in `recovery.test.ts`.

- **Mumbai afternoon storm** (BOM 15:00–16:30): DS0303 leaves 20 min late, so crew CR03 would
  reach 605 of 600 minutes and DS0304 Delhi–Kolkata is cancelled: 167 stranded. Spare VT-DS18
  at Delhi recovers it fully. (The dataset has no Bengaluru–Kolkata flight; this is the
  equivalent of the organisers' example.)
- **Delhi afternoon thunderstorm** (DEL 15:00–16:30): two crews time out on two aircraft; the
  single Delhi spare can save only one: 267 stranded, best plan 117.
- **Hyderabad midday storm** (HYD 11:30–13:30): 379 stranded, four broken connections.
- **Delhi fog, then Mumbai rain**: two storms on the same morning.

## Limits and known gaps

- Spares can only take flights leaving their own base; ferry flights are not modelled.
- No diversions, no reserve crews, no rebooking onto later flights.
- The live Gemini path is implemented against the `@google/genai` SDK's type definitions and is
  tested with a scripted client (valid plan, repair, double failure, unknown actions, budget,
  timeout, service error), but it has not been run against the live API in this repository (the
  tests run without a key). See "Before a demo" above.
- Each AI route accepts up to 8 KiB of JSON and applies a rolling limit of 30 requests per
  client per minute within one server instance. The deployment proxy must set the forwarded
  client address. Limits reset when the instance restarts.
- On phones the impact table and scenarios sit below the board (accepted for this version; the
  demo surface is a laptop).

Design history: `docs/concepts_brief.md` (brief), `docs/reviews/` (independent review rounds and
how each finding was resolved).
