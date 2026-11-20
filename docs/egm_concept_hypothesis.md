# Domino Sky — concept under review (EGM brainstorm input)

Author: Yeswanth Raj · Date: 2026-11-20 · Dataset: `c:\prompt aah\datsett.json`

## Problem (from the organisers)

A 90-minute thunderstorm in Mumbai can cancel a flight from Bengaluru to Kolkata five
hours later. Each aircraft flies a chain of flights through the day, so when one plane
is held at an airport, every later flight on its chain starts late. Late arrivals also
break passenger connections and push crews past legal duty hours.

Build Domino Sky: an interactive simulator where a user closes any airport for a chosen
time window and watches delay spread across the network. Show which flights are late,
why they are late, and how many passengers are stranded. Then an AI dispatcher
recommends recovery actions (for example cancel one flight, or swap in a spare
aircraft) and the app shows the network before and after.

Hard rule: all delay and passenger numbers come from deterministic code. The AI explains
and recommends; every number it states must match the app's own calculation.

Dataset: 16 airports, 70 flights, 16 aircraft (tails), 21 passenger connections, 16 crews
(one per tail, max duty 600 min), 2 spare aircraft (VT-DS17 at BLR, VT-DS18 at DEL,
available from 05:00). Single operating day, IST. Min turnaround 30 min. 180 seats.

## Setting

- Competition. Judged by one AI judge and three human judges.
- Deployed on Vercel. Needs to be a fast prototype that works and looks impressive.
- User added: the main screen should be a **2-D environment like the tools a real
  airline operations controller uses** (an operations control centre view), and should
  draw on what actually engages people visually, not decoration.

## Anchored hypothesis

A Next.js (TypeScript) app on Vercel. A pure, deterministic simulation engine runs in the
browser. It applies an airport closure, propagates delay along each aircraft's flight
chain, through passenger connections and into crew duty limits, and records a cause for
every delay. A 2-D operations view (map of India + per-aircraft timeline) shows the
result, and a clickable "why is this late?" chain traces any flight back to the storm.
Claude Opus 5.5 (`claude-opus-5-5`, called from one Vercel serverless route; key stays
server-side) picks and explains recovery actions but can only cite numbers by reference;
the code fills them in. A clearly labelled offline dispatcher takes over if the AI fails.

## Decisions taken so far (the author delegated these; challenge them)

### Simulation rules
1. Closure window [start, end] at airport X: no departures from X and no arrivals at X.
2. Departures from X scheduled in the window are held until X reopens.
3. Flights bound for X that would arrive in the window are held at their origin so they
   arrive at reopening (ground delay). No diversions — the dataset has no alternates.
4. Flights already airborne when the closure starts are allowed to land (stated assumption).
5. Each later leg: departure = max(scheduled departure, previous arrival + 30 min,
   reopening time if departing X). Arrival = departure + block minutes.
6. Airport capacity_per_hour is NOT modelled: the busiest Domino Sky hour at BOM has
   about 8 movements against a capacity of 32, so it never binds.

### Crew
7. Duty = duty_start → actual arrival of last flight; limit 600 min. If a leg would end
   past the limit, that leg and every later leg on the tail are cancelled ("crew illegal").
8. No reserve crews (none in the dataset). A spare aircraft is assumed to come with a
   standby crew (stated assumption), otherwise spares are useless.

### Passengers
9. Stranded = passengers on cancelled flights + connecting passengers whose connection
   breaks (to_flight departs < min_connect after from_flight's actual arrival, or
   to_flight cancelled), where the inbound flight itself operated. Each passenger counted
   once. Delayed-but-flown passengers shown separately as "delayed" with passenger-minutes.

### Recovery actions
10. Cancel a round pair (X→Y and Y→X) so the aircraft stays positioned for its next leg.
11. Swap a spare aircraft into any leg of a delayed chain. Ferry time = scheduled block
    time of an existing flight on the same city pair when present; otherwise a
    great-circle estimate, labelled as an estimate.

### AI / number integrity
12. Engine enumerates every candidate action and simulates each one (scored table).
13. AI receives facts + candidate table, returns structured JSON: chosen action IDs
    (may combine several) and explanation segments in which numbers appear only as fact
    references (e.g. `{stranded_after}`), never as literal digits.
14. Engine re-simulates the AI's chosen combination and renders every number itself.
    A validator rejects any explanation containing an unreferenced digit.
15. If the AI call fails or times out: deterministic best-scored plan + template text,
    labelled "offline dispatcher".

## Data facts found during clarification
- Crew CR03 (VT-DS03) is scheduled 11:30–21:20 = 590 of 600 min: only 10 min slack. Its
  chain includes DS0303 BOM→DEL at 16:10, so a Mumbai afternoon storm cancels DS0304
  DEL→CCU at 18:55 via the crew clock. CR08 has 20 min slack.
- Seven legs leave exactly at the 30-min minimum turn (zero slack): DS0402, DS0504,
  DS0604, DS0704, DS1202, DS1304, DS1403.
- Spares exist only at BLR and DEL.

## Visual / frontend constraints (AntiSlopUI design contract, chosen by the author)
- Light theme: a "printed aviation chart" map look (warm off-white paper, thin routes,
  real airport codes). No glow, no glassmorphism, no purple/indigo, no gradient text.
- Brand hue clay `#B45309` (domain: safety/urgency/logistics) — used ONLY for the cause
  (storm/closed airport). Delay severity uses its own grey→red scale. Colour is never the
  only signal: every state also has a text label (e.g. "+47m") and a shape/pattern
  (solid on-time, hatched delayed, struck-through cancelled).
- Bricolage Grotesque display + Inter body; tabular numbers on every number.
- Motion: max one ambient animation (the storm cell). Cascade playback is user-triggered,
  each transition ≤250 ms, and renders the final state statically under
  prefers-reduced-motion.
- No raw HTML injection of AI text: AI output is rendered as structured segments.
- Accessibility: real buttons, visible focus, keyboard operable, 4.5:1 body contrast.

## Planned screens (first pass)
- Left: closure controls (airport, start, duration) + scenario presets.
- Centre: 2-D map of India with routes and a time scrubber; storm cell over the closed airport.
- Bottom: "domino" timeline, one row per aircraft (16 rows), bars slide and fall.
- Right: impact numbers (late flights, cancelled flights, stranded passengers, crew
  breaches), the "why is this late?" chain, and the AI dispatcher panel with a
  before/after comparison slider.

## Known weakest point
Does the AI genuinely decide anything, or only narrate the engine's top-ranked option? A
sceptical judge may say a sort would do the same.
