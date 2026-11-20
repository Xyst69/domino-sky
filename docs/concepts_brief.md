# Domino Sky — airline disruption simulator with an AI dispatcher

* **Author:** Yeswanth Raj
* **Date:** 2026-11-20
* **Inputs:** organisers' problem statement · dataset `datsett.json` · concept under review `egm_concept_hypothesis.md` · AntiSlopUI design contract · research on airline operations-control tools and interactive explainers

## Reviewer status

| Reviewer lens | Status |
| --- | --- |
| Design critic (skeptical architect) | completed |
| Codebase / data details | completed |
| Zoom-out strategist | completed |
| Comprehension (UX) | completed |
| Implementation readiness | completed |
| Structural architecture | completed |
| Inventive catalyst | completed |

## Overview

Domino Sky is a web app, deployed on Vercel, for a competition judged by one AI judge and
three human judges. A user closes one or more airports for a time window, by dragging a
storm onto the map, picking a preset or describing the crisis in plain English. The app shows how that
closure spreads through one airline's day: aircraft arrive late, so their next flights leave
late; crews run past their 600-minute duty limit, so flights are cancelled; passengers miss
connections. Every flight shows why it is late, traced back to the storm.

An AI dispatcher (Google Gemini, using the author's API key) then recommends recovery actions, such as putting a spare
aircraft on a flight. The app shows the network before and after. The AI never writes a
number. It writes sentences with placeholders, and the app's own calculation fills every
number in, so the hard rule "every number the AI states must match the app" holds by
construction, not by hope.

The main screen is modelled on what airline operations controllers actually use: a
per-aircraft timeline board (a "Gantt"), supported by a map. It opens on a story already
loaded — rain in Mumbai at 3 pm cancels the 7 pm Delhi–Kolkata flight because its crew runs
out of legal hours — and then hands the controls to the judge.

## Judging criteria and how the design answers them

The organisers' judging scheme has three stages: a pass/fail gate, a 100-point scorecard and
four live "anti-fake" tests. An AI evaluator reads the repository; human judges run the live
tests. An entry that looks good but fails the buffer-absorption test or the grounded-AI test
has its Problem-Solving and AI scores capped at 50%. The design is built against this scheme
line by line.

### Stage 1 — gate (pass/fail)

| Requirement | How Domino Sky meets it |
| --- | --- |
| Live public URL, no console crashes | Deployed on Vercel from phase 1 onward; every phase ends deployed. A zero-console-error check is part of the polish phase. |
| Not a static table or search form | The main view is an interactive per-aircraft board and map. |
| Build authenticity: fresh event-day commits, no single giant dump | The repository is started on the event day and committed at the end of every build step (dozens of small commits with clear messages), never as one upload. |

### Stage 2 — scorecard

| Criterion | What the top band asks for | Design answer |
| --- | --- | --- |
| Innovation & Creativity (25) | Memorable interaction: draggable storm cells, live aircraft "domino tracks", a playable clock | Drag a storm cell onto any airport on the map and stretch it to set duration; the domino board (one track per aircraft) is the main view; a playable clock moves a now-line across the board and moves aircraft along their routes on the map. Light aviation-chart look, which avoids the "generic dark map" the low band describes. |
| Problem-Solving (25) | Aircraft chains + broken connections + crew duty cut-offs + working recovery with measured before/after | All four layers are in the engine (sections 3–6); before/after change strip shows delay minutes, stranded passengers and cancellations going down. |
| AI & Prompting (20) | Structured AI that (a) turns plain-English crises into real simulation events and (b) proposes an executable plan with a one-click Apply that changes the live simulation | Two AI jobs, both schema-bound: the **crisis compiler** turns text such as "fog at Delhi until 9, thunderstorm over Mumbai 3 to 4:30" into closure events the engine runs; the **dispatcher** proposes a plan of action IDs, and an **Apply** button applies it to the live simulation, with Undo. |
| Functionality & Execution (20) | Stable under rapid scrubbing, several storms at once, live recovery; clean reset; graceful fallback when an outside service is down | **Several closures at once are now in scope.** State is a list of events and actions re-computed from scratch each time, so reset and undo return the exact earlier state. Offline dispatcher and a rule-based crisis parser cover AI failure. |
| Presentation & UX (10) | Green → amber → red states; one-click presets; a judge can trigger a storm, trace a four-step chain and run a recovery without instructions | Status uses green / amber / red, always with a label and a shape; presets are one click; the opening scenario and the "why is this late?" chain support the ten-second "aha". |

### Stage 3 — the four live tests, and what the app shows for each

1. **Buffer absorption.** A 20-minute closure versus a 110-minute closure at the same airport
   must give different results: flights with generous turnarounds absorb small delays. The app
   makes absorption visible, not just correct: a flight that took delay but recovered it in its
   turnaround shows an "absorbed 15 of 20 min" mark, and the cause chain stops there. Closure
   duration goes down to 10 minutes. Golden tests cover both cases.
2. **Hub versus spoke.** A storm at GAU or TRV must affect only aircraft that pass through it.
   The engine has no scripted animation; every effect comes from the aircraft and crew chains.
   Golden tests include GAU and TRV closures.
3. **Live recovery delta.** One recovery move (swap a spare, cancel a pair, hold a flight for
   connecting passengers) must lower delay minutes, stranded passengers and the affected
   statuses at once, and undo must restore the exact earlier state. Every move is available
   by hand, not only through the AI. **The hold-for-connection action is therefore kept in
   version 1** (it is named in this test).
4. **Grounded AI.** After an unrehearsed storm (for example 75 minutes at HYD) the AI must cite
   the exact flights, aircraft and passenger counts affected by that storm. This holds by
   construction: the server re-runs the engine for the current scenario, the AI may only use
   the entity IDs and fact keys of that run, and the app fills in every number. Every request,
   preset or not, goes to the live model; there is no answer cache (see review round 1, R1-22).

### What the AI evaluator will read

A clean repository: the engine as its own folder with no UI code, tests next to it, the AI
prompts in their own versioned files with their response schemas, and a README that explains
the rules, the number guarantee and how to run the tests.

## Analysis

### 1. The AI must make a real decision (raised by all seven reviewers in some form)

The original design had the engine score every recovery option with one number and fall back
to "the best-scored plan" when the AI is offline. Once one number ranks everything, sorting is
the best dispatcher by definition: the AI can only agree with the sort or do worse. A judge who
asks "what does the AI decide?" would get no good answer. The search space is also tiny (about
100–150 single actions on 70 flights), so the engine can try every combination of up to three
actions in about a second.

**Resolution (adopted):**

- **No single score.** Each plan gets a row of separate measures: passengers stranded,
  flights cancelled, passenger-minutes of delay, crew breaches, spare aircraft used, aircraft
  out of position at end of day. The engine keeps only the plans that are not worse on every
  measure than some other plan (the "Pareto set"). Choosing among those is a genuine
  judgement call that depends on priorities.
- **The operator states a priority** in plain words or by picking one: "protect connections",
  "fewest cancellations", "keep one spare free for the evening". The AI turns that priority
  into a choice and explains the trade-off.
- **The AI can test its own ideas.** It gets a `simulate(actions)` tool backed by the engine,
  with a small budget (at most 3 calls). The panel shows its trail: "tried A → 412 stranded;
  tried A + B → 167 stranded". Every number in that trail comes from the engine.
- **Show the disagreement.** The engine's default pick (a published fixed order: stranded,
  then cancellations, then delay minutes, then spares used) sits next to the AI's pick. When
  they differ, the AI must give its reason. When they agree, the panel says so plainly.
- **Offer a scenario where the choice is hard.** In the flagship crew-clock scenario the only
  fix is the Delhi spare taking DS0304, which makes the AI look trivial. A second preset — a
  Mumbai morning storm hitting the 07:30–09:00 bank, where most BOM connections (CX01–CX05) and
  six aircraft are affected and there are only two spares — makes spare allocation a real
  dilemma. Its numbers must come from the engine, not from this brief.

### 2. The "AI cites numbers only by reference" contract (Blocker from five reviewers)

The planned check — reject any digit the AI writes — fails both ways. It rejects almost every
useful sentence, because flight IDs (DS0304), aircraft (VT-DS18), crews (CR03) and times
(18:55) all contain digits. It also lets real numbers through when written as words ("forty",
"half", "twice as many"), and it cannot catch false comparisons with no number in them
("fewer people stranded than cancelling").

**Resolution (adopted):** the AI's explanation is a list of typed pieces:

- `text` — plain words. Must contain no digits (any script) and no number words.
- `entity` — a flight, aircraft, crew, airport or time, by ID. The app formats it.
- `fact` — a measured value by key, scoped to a named result: `closure.stranded`,
  `plan.stranded`, `default.cancelled`. Keys the AI was not given are rejected.
- `compare` — a claim such as `plan.stranded < closure.stranded`. The engine checks it.

The allowed fact keys and entity IDs are sent as fixed lists (enums) in the response schema
for each request. If validation fails, the AI gets one repair attempt with the error; after
that the app uses the offline dispatcher. The explanation may only reference facts of the
plan the engine actually re-simulated, so the AI cannot describe a combined plan using numbers
from single actions (combined effects do not add up).

The same structure is used by the offline dispatcher, so the UI has one rendering path and
never injects raw HTML. Each rendered number carries a small "computed by engine" marker that
reveals its fact key on hover — direct, visible proof for the judges.

### 3. Simulation rules: corrections found by the reviewers

- **Rule 5 had a bug.** "Departure = max(…, reopening time if departing X)" would push every
  departure from X to the reopening time, including a 06:00 departure before a 14:00 storm.
  The reopening term applies only when the computed departure falls inside the closure.
- **Ground delay was missing from the formula.** A flight bound for X whose arrival would fall
  inside the closure leaves at `reopening − block time`. Both checks use propagated times, not
  scheduled ones: a flight can become due during the closure because it is already late.
- **Window boundaries.** The closure is the half-open window `[start, end)`: a departure at
  exactly the reopening minute is allowed.
- **Rules 1 and 4 contradicted each other** ("no arrivals" vs "airborne flights may land").
  Rule 1 now reads: no departures from X and no new arrivals at X; flights already airborne
  when the closure starts land as scheduled. The design critic proposed an extra "closure known
  at" time with airborne holding instead; it is listed under Alternatives.
- **Flights never wait for connecting passengers.** Connections only break. This keeps the
  calculation one-way (no loops) and matches the dataset, which has no hold rule.
- **Capacity.** Not modelled, now with a stronger reason: at every airport the whole day's
  Domino Sky movements are below one hour's capacity (BOM 18 vs 32, DEL 20 vs 40, BLR 22 vs
  34). So capacity cannot bind even if every held flight moves at the reopening minute. The
  engine asserts this as an invariant and the Assumptions panel says so.
- **Time.** All engine times are whole minutes since 00:00 IST. Values may pass 1440 and show
  as "+1d". The engine never uses JavaScript `Date`, so results cannot differ between a judge's
  browser time zone and Vercel's UTC servers.

### 4. Crew duty: a deliberate, labelled departure from the dataset note

The dataset note says duty runs to the *scheduled* arrival of the crew's last flight. Read
literally, a delay could never push a crew over its limit, which contradicts the organisers'
own problem statement ("push crews past their legal duty hours"). Domino Sky reads "scheduled"
as the *revised* schedule after the disruption, and shows this reading in the Assumptions
panel with one line of reasoning. Exactly 600 minutes is legal ("must not exceed"). Duty start
stays fixed even if the first flight is late — a conservative choice, also labelled.

When a leg would end past the limit, that leg and every later leg on the aircraft are
cancelled and marked "crew out of legal hours".

Verified slack: CR03 10 min, CR08 20 min, CR10 30 min, CR11 45 min, CR04 65 min, all others
70 min or more.

### 5. Counting stranded passengers without double counting (Blocker from three reviewers)

The data shows that a flight's `pax` already includes its connecting passengers. DS0304
carries 167 and CX19 brings it 14 more; counting them on top would give 181, more than the
180 seats. Connections are therefore a subset of both flights' passengers.

**Formula (adopted):**

> stranded = (passengers on cancelled flights)
> − (connecting passengers whose inbound and onward flights are both cancelled)
> + (connecting passengers whose inbound and onward flights both operated but the connection broke)

A passenger counted as stranded is not also counted as delayed. Each case gets a unit test.

### 6. Recovery actions, defined so they can be built and combined

- **Swap in a spare.** The spare takes leg *k* and every later leg of one aircraft's day; the
  original aircraft stops where it is. The spare comes with a standby crew whose duty starts
  45 minutes before its first departure, with the same 600-minute limit. A spare cannot leave
  while its base airport is closed. **Version 1: a spare can only take legs leaving its base
  (BLR or DEL).** Empty positioning flights (ferries) and the distance-based flight-time
  estimate are deferred.
- **Cancel an out-and-back pair.** Only legs that form X→Y then Y→X on the same aircraft
  qualify (for example DS0502/0503, DS0701/0702, DS0703/0704, DS1003/1004, DS1201/1202,
  DS1203/1204, DS1503/1504). VT-DS03 and VT-DS11 have no such pair, so this action cannot help
  in the flagship scenario. Cancelling a pair also breaks the connections it
  carries (cancelling DS0703/0704 breaks CX07, CX11 and CX17); the score includes them.
- **Hold a departure to protect a connection** (up to a set number of minutes). Cheap to
  build, and it creates the kind of trade-off the AI is there to weigh: delay 170 people to
  save 43.
- **Actions are data, not special cases.** Each action is a patch applied to the unchanged
  base schedule before simulation, with a stable ID built from its content, for example
  `SWAP:VT-DS18:DS0304`. A conflict checker rejects impossible combinations with a typed
  reason: the same spare used twice, a swap on a cancelled leg, a spare not at the departure
  airport. The AI's `simulate` tool returns those reasons so it can correct itself.

### 7. What the judges see, and in what order

**Research findings (airline operations tools and interactive explainers):**

- Operations-control products (Lufthansa Systems NetLine/Ops++, Crane OCC) are built around a
  per-aircraft timeline board, with a crew timeline and an alert list beside it; a late flight
  pushes the later bars along in that board. The map is secondary.
- One airline study draws the network two ways: airports joined by flights, and flights
  joined by what passes between them (aircraft, crew, passengers). The second is exactly the
  "why is this late?" chain.
- Interactive explainers that hold attention guide the reader to one clear event first, then
  end in a sandbox where they can push too far and see things break.

**Screen plan (adopted):**

1. **Opening state.** The flagship scenario is already loaded: Mumbai closed 15:00–16:30.
   One sentence built by the engine reads, for example, "Mumbai closed 15:00–16:30 → 1 flight
   late, 1 cancelled, 167 passengers stranded" (figures from the hand check below, to be
   confirmed by the engine). One primary button: "Play the cascade". The screen says that
   DS0304 Delhi→Kolkata stands in for the organisers' Bengaluru→Kolkata example, because the
   dataset has no Bengaluru→Kolkata flight.
2. **Main view — the domino board.** One row per aircraft (16) plus two rows for the spares,
   which sit idle until a recovery uses them. Time axis labelled IST. Bars keep their colour
   meaning and also carry a shape and a label: solid = on time, hatched with "+47m" = late,
   struck through with "×" = cancelled. After a recovery, "before" bars stay as faint ghosts
   under the "after" bars.
3. **Map — an aviation-chart style.** A latitude/longitude grid with airports at their real
   positions and routes as thin lines; **no national border is drawn**, which removes the risk
   of an incorrect outline of India. Route line styles carry state (solid, dashed for late,
   dotted with "×" for cancelled). Only affected routes are drawn strongly. The storm cell over
   the closed airport is the page's one continuous animation. Aircraft held at another airport
   because of the closure show a "holding" mark with a thin line to the closed airport, so
   delays far from the storm do not look like bugs.
4. **"Why is this late?" chain.** Click any late or cancelled flight. The chain shows each
   step, the link type (aircraft, crew, passengers) and the minutes it added, for example:
   *Mumbai closed → DS0303 held 20 min → DS0304 crew would reach 605 of 600 minutes →
   DS0304 cancelled.* At most five steps are visible; the rest collapse. The same path lights
   up on the board and the map at once.
5. **Dispatcher panel.** Priority picker → the engine's default pick next to the AI's pick →
   the AI's trail of tried plans → its explanation, with every number marked as computed by
   the engine → a change strip ("Stranded 167 → 0"). If the AI is unavailable, the panel says
   **Offline dispatcher** in full view, not in fine print.
6. **Assumptions panel.** Lists every rule in this brief in plain words, including the crew
   duty reading and the capacity invariant.

**Shared state:** one selected flight and one current time drive every panel. Clicking a
flight anywhere highlights it everywhere.

**Cascade playback:** it plays in waves by causal depth (wave 0 = flights held by the closure,
wave 1 = their knock-on delays, and so on). Each wave lasts at most 250 ms, about 2 seconds in
total, with a "Wave 2 of 4" counter and a Skip control. With reduced motion turned on, the
final state appears at once with wave numbers as labels.

**Plain labels for non-specialists:** "Aircraft VT-DS03" not "tail", "Crew out of legal
hours" not "crew illegal", "Cancel out-and-back pair" not "cancel round pair". Technical
terms appear in tooltips.

### 8. Visual design under the AntiSlopUI contract

- **Theme:** light, styled like a printed aviation chart. Rejected: the dark, glowing
  "control room" (see Alternatives).
- **Colour (revised after the judging criteria):** the scorecard names green → amber → red
  states, and AntiSlopUI allows those three hues for status only. Clay `#B45309` would then
  look the same as amber, so the brand accent moves to chart-ink slate `#334155`. Recorded as
  `OVERRIDE: #B45309 → #334155 [domain table: infrastructure; clay collides with amber
  status]`. The storm is drawn as a hatched ink cell with a "CLOSED" tag, not as a colour.
  Status is never colour alone: on time = solid bar, late = hatched bar with "+47m",
  absorbed = solid bar with a small "absorbed" mark, cancelled = struck-through bar with "×".
  Green, amber and red are chosen so they still differ in lightness for people with red–green
  colour blindness.
- **Type:** Bricolage Grotesque for headings, Inter for body text, fixed-width (tabular)
  digits for every number so values do not jump during playback.
- **Motion:** user-triggered motion (playing the cascade, dragging time) is allowed by the
  contract and is where the visual impact comes from. Only the storm cell moves on its own.
- **Where the impression comes from:** density and cause-and-effect — the same path lighting
  up on the board and the map — rather than glow or effects.

### 9. Running it on Vercel, safely and reliably

- **One engine, two places.** The engine is a plain TypeScript module with no React, no
  `Date` and no locale code. The browser and the API route import the same module.
- **The server does not trust the browser.** The `/api/dispatch` route accepts only the
  scenario parameters (airport, start, duration, priority) and re-runs the engine itself to
  produce the facts it sends to the AI and to validate the AI's answer. A forged request cannot
  change the numbers.
- **Model call (author's decision: Gemini).** Google's official Gen AI SDK for TypeScript
  (`@google/genai`), called only from the `/api/dispatch` route. The key lives in the
  `GEMINI_API_KEY` environment variable (Vercel project settings, and a git-ignored
  `.env.local` for local runs); it is never sent to the browser or committed. The model ID is
  read from a `GEMINI_MODEL` variable rather than hard-coded, because Gemini model names
  change often; the exact ID is confirmed against the live model list for the author's key
  during the build. A Flash-class model is the default for demo speed, with a Pro-class model
  as an option. The call uses Gemini's structured output (a response schema with the fact-key
  and entity-ID enums) and function calling for the `simulate` tool with a 3-call budget.
  Gemini supports only part of JSON Schema, so the schema is kept to plain objects, arrays,
  strings and enums, and the server's own validator remains the final check. The client gives
  up after about 25 seconds; the route's `maxDuration` is set explicitly above that. The
  design does not depend on the provider: the engine, the typed explanation format and the
  validator are the same for any model.
- **Speed for the demo.** Engine results appear instantly; the AI's explanation arrives
  afterwards. A pre-generated answer cache was planned but not built (review round 1, R1-22);
  instead the author runs each preset once against the deployed site before the demo.
- **Abuse and cost.** Per-IP rate limit on the route, a spend cap on the API key, and an
  `AI_ENABLED` switch that forces offline mode without a redeploy.
- **Version skew.** Requests carry `ENGINE_VERSION` and the scenario hash; the response
  echoes them. The browser drops any answer that does not match the current scenario (for
  example, if the judge changed the closure while the AI was thinking).
- **Data check at start-up.** The dataset is validated on load: every aircraft's legs join up
  airport to airport and block times match departure and arrival times.

### 10. Proof for the AI judge

- **Golden scenario tests** with hand-checked numbers (see Key Decisions).
- **Property tests:** no flight leaves before its scheduled time; every turnaround is at least
  30 minutes; no passenger is counted twice; stranded never exceeds the total of `pax`.
- **Validator tests:** rejects "two", "40" and digits in other scripts; accepts entity IDs;
  the numbers on screen always equal the re-simulated plan.
- **A README** that states the hard rule and points to the tests that prove it.

### Ideal final result

The engine is the only source of numbers. The AI is the only source of judgement about
trade-offs. Neither can stand in for the other, and the screen shows both side by side.

## Goals vs. Non-Goals

* **In-scope goals:**
  - One or more airport closures at once, each with any start time and a duration from 10
    minutes up; set by dragging a storm cell on the map, by presets, or in plain English
    through the AI crisis compiler (with a rule-based parser as fallback).
  - A playable clock that moves the board's now-line and the aircraft on the map.
  - One-click Apply of the AI's plan, manual recovery moves, Undo and Reset that restore the
    exact earlier state.
  - A visible "absorbed" state for delay soaked up by turnaround buffers.
  - Delay spreading along aircraft rotations, crew duty limits and passenger connections,
    with a recorded cause for every late or cancelled flight.
  - Stranded and delayed passenger counts using the formula in section 5.
  - Recovery actions: swap a spare (from its base), cancel an out-and-back pair, hold a
    departure for a connection.
  - AI dispatcher choosing among non-dominated plans under a stated priority, with a
    `simulate` tool, typed explanations and a visible comparison with the engine's default.
  - Offline dispatcher with the same output structure.
  - Domino board, chart-style map, cause chain, before/after comparison, Assumptions panel.
  - Golden, property and validator tests; deployed on Vercel.
* **Out-of-scope non-goals:**
  - Live weather data (for example Open-Meteo). The scorecard mentions it only as an example
    of an outside service needing a fallback; closures come from the user.
  - Diversions to alternate airports (the dataset has no alternates).
  - Airport capacity limits (shown not to bind; asserted as an invariant).
  - Reserve crews beyond the standby crew that comes with a spare.
  - Rebooking passengers onto later flights (possible later: free seats are 180 − pax).
  - Spare ferry flights and distance-based flight-time estimates (version 2).
  - A dark theme (AntiSlopUI would then require both themes to pass contrast checks).
  - National borders on the map.

## Alternatives Weighed

- **A single score with the AI explaining the top-ranked plan.** Rejected by author after
  review: a sort makes the AI redundant, and judges would see that.
- **A digit-only check on free AI text.** Rejected by author after review: blocks valid IDs
  and times, misses number words and false comparisons.
- **Free AI text checked for numbers afterwards.** Rejected by author: it can only detect a
  wrong number after the fact; typed pieces make wrong numbers impossible to render.
- **Dark, glowing "control room" look.** Rejected by author: AntiSlopUI flags glow and the
  standard dark-plus-accent theme as AI-generated defaults, and it is what most competing
  entries are likely to use.
- **Map as the main view.** Rejected by author after research: real operations tools are
  timeline-first, and 16 airports carry little information on a map.
- **Map time slider as a core feature.** First deferred, then restored after the judging
  criteria named a playable clock and rapid scrubbing: the clock is now core.
- **One closure at a time.** First adopted, then dropped: the scorecard tests several storms
  at once.
- **Clay `#B45309` as the brand accent.** First adopted, then replaced by slate: it collides
  with the amber status colour the scorecard expects.
- **Before/after wipe slider.** Replaced by a Before/After toggle, ghost bars and a change
  strip, because small differences are missed in a wipe.
- **"Closure known at" time with airborne holding** (design critic). Not adopted for version
  1: letting airborne flights land keeps the rules simpler and still produces the flagship
  cancellation. It can be added as a rule option.
- **Spare ferries with a distance-based flight-time estimate.** Deferred: the flagship
  recovery needs no ferry, and the estimate is data we would invent.
- **Modelling airport capacity.** Rejected by author: it cannot bind with this dataset.
- **Duty measured to the original scheduled arrival (literal dataset note).** Rejected by
  author: delays could then never break crew limits, contradicting the problem statement.
  Shown in the Assumptions panel.
- **Fixed duty start vs duty start moving with a late first flight.** Fixed start chosen as
  the conservative option and labelled.
- **Drawing India's outline from map data.** Rejected by author: an incorrect border is a
  reputational and legal risk in India; a coordinate grid fits the chart style.

## Key Decisions & Staging for Next Steps

### Hand-checked golden scenarios (to be confirmed by the engine)

1. **Baseline, no closure:** 0 late, 0 cancelled, all 21 connections made, every crew legal,
   CR03 slack exactly 10 minutes.
2. **Mumbai 15:00–16:30 (flagship, "the crew clock"):** DS0302 left Ahmedabad at 14:25, is
   airborne at 15:00 and lands 15:35 → DS0303 held to 16:30 (+20 min), lands Delhi 18:40 →
   DS0304 would leave 19:10 and land 21:35 → CR03 duty 605 minutes → DS0304 cancelled →
   167 stranded (the 14 CX19 connecting passengers are already inside the 167). Recovery:
   VT-DS18 takes DS0304 from Delhi → 0 stranded.
3. **Thresholds for the flagship:** a 14:30–16:00 closure gives DS0303 no delay. DS0304 is
   cancelled only if DS0303 leaves more than 15 minutes late (5 minutes of turn slack at Delhi
   absorb the first 5). These are good boundary tests.
4. **Kolkata crew cascade (second crew scenario):** CR10 has 30 minutes of slack across
   DS1001–DS1005 with 5 minutes of turn slack per leg, and CX21 (14 passengers) feeds DS1005.
   CX14 (DS1101→DS0105, 20 passengers) has only 5 minutes of connection slack.
5. **Mumbai morning bank 07:30–09:00 (the hard-choice preset):** numbers to be produced by
   the engine and then frozen as a golden test.

### Build plan (each phase ends committed and deployed on Vercel)

Ordered by scorecard weight: the engine carries Problem-Solving (25) and most of
Functionality (20), so it comes first and is tested hardest.

1. **Skeleton.** `git init` on the event day, Next.js + TypeScript project, dataset loader
   with validation, minute-based time helpers, blank page deployed. Small commits from here on.
2. **Engine.** Several closures → aircraft chains with absorption → crew rule → passenger
   counts → cause records; golden tests for the flagship, buffer absorption (20 vs 110 min),
   GAU and TRV spokes, two storms at once; property tests.
3. **Recovery.** Action patches (swap spare, cancel pair, hold for connection), conflict
   checker, Pareto set, engine default order, offline dispatcher with typed explanations;
   state as an event list so Undo and Reset are exact.
4. **Domino board.** 18 tracks, status with colour + shape + label, absorbed marks, linked
   selection, impact headline, manual recovery moves with live before/after strip.
5. **Map and clock.** Chart-style map from coordinates (no border), draggable and stretchable
   storm cells, holding marks, playable clock moving aircraft and the now-line, cause chain
   lit on both views.
6. **AI.** Gemini route with the crisis compiler and the dispatcher (`simulate` tool),
   validator with one repair attempt, one-click Apply, rate limit, version and hash checks,
   rule-based fallbacks for both AI jobs.
7. **Polish and proof.** Cascade waves, Assumptions panel, fonts and patterns, accessibility
   and zero-console-error pass, AntiSlopUI pre-delivery audit, README for the AI evaluator,
   and a rehearsal of the four live tests.

### Open questions for the author

1. **API key — resolved.** The author has a Gemini API key; the dispatcher uses Gemini.
   Check the key's plan: on Google's
   free tier, prompts may be used to improve Google's products and rate limits are low, which
   matters if judges click quickly. The dataset is organiser-provided and not sensitive.
2. **Hold-for-connection action — resolved.** Kept in version 1: the judges' live recovery
   test names it.
3. **Crew duty reading.** Accept "revised schedule" as the interpretation, or ask the
   organisers?
4. **Morning preset.** If the engine shows the 07:30–09:00 Mumbai storm does not create a
   real choice between the two spares, which other window should be the hard-choice preset?
