# Goldfish Review Report — round 1

**Target:** Domino Sky codebase (`src/`, `app/`, `README.md`) — full codebase
**Standards:** `docs/concepts_brief.md` (including the judging criteria), the EGM implementation-readiness standard

## Reviewer status

| Reviewer | Status |
| --- | --- |
| `codebase_details` | completed |
| `implementation_readiness` | completed |
| `design_critic` | completed |
| `comprehension` | completed |

Round result: **not clean** (Major findings open). No Blockers.

## Findings and resolution (Blockers → Major → Nits)

Duplicates raised by more than one reviewer are merged; the lenses are listed.

| ID | Severity | Lens | Finding | Resolution |
| --- | --- | --- | --- | --- |
| R1-1 | Major | codebase_details | Passengers on late flights counted again as delayed when their connection broke or their other leg was cancelled; connectors on two late legs counted twice; stranded passengers' delay minutes still counted. | PROPOSE FIX — count each connecting passenger once by final outcome; unit test added. |
| R1-2 | Major | codebase_details | Cause chain shows the wrong window when one airport has two closures. | PROPOSE FIX — causes record the closure index. |
| R1-3 | Major | codebase_details, design_critic | Digit check misses most scripts, superscripts, fractions, Roman numerals; word list misses ordinals, "million", "both", "-fold". | PROPOSE FIX — `\p{N}`, Roman-numeral tokens, extended word list, tests. |
| R1-4 | Major | design_critic | AI-written text reaches the screen unvalidated through the rejection reason, trail errors and crisis notes. | PROPOSE FIX — only fixed, engine-written messages are shown; AI notes dropped; raw text logged on the server only. |
| R1-5 | Major | design_critic | A compare segment shows "checked" without its direction, so it can sit beside a false sentence; units not checked. | PROPOSE FIX — the app writes the inequality and the scenario names itself; units must match; comparative words require a compare segment. |
| R1-6 | Major | design_critic | The AI mostly narrates the engine default; the plain-words constraint from the brief was not built; plan agreement is order-sensitive. | PROPOSE FIX — optional operator note (a constraint the sort cannot encode) passed to the AI as untrusted data; order-insensitive comparison; the prompt requires a reason when it differs. |
| R1-7 | Major | implementation_readiness | Stale-response guard compares the request's own hash with its echo, so it never fires. | PROPOSE FIX — the server recomputes the hash; the browser compares against the current scenario through a ref; client timeout added. |
| R1-8 | Major | implementation_readiness, design_critic | Fact-key enum repeated three times may exceed Gemini schema limits; no output cap; thinking not configurable; parallel simulate calls exceed the budget; unknown function names break the next turn. | PROPOSE FIX — enums removed from fact fields (keys stay in the prompt and the validator); `maxOutputTokens`; optional `GEMINI_THINKING_LEVEL`; budget checked per call; unknown calls answered with an error. |
| R1-9 | Major | implementation_readiness, design_critic | Crisis output can produce closures the dispatch route rejects (over 12 hours). | PROPOSE FIX — clamp to 5–720 minutes in both crisis paths with a visible note. |
| R1-10 | Major | implementation_readiness | No tests for the AI dispatcher or the crisis compiler. | PROPOSE FIX — mocked-SDK tests: valid plan, repair, two failures, timeout, unknown action. |
| R1-11 | Major | comprehension | Recovery flow below the fold. | PROPOSE FIX — dispatcher moved directly under the presets; closure editor moved down. |
| R1-12 | Major | comprehension | Cause chain blank or stale after a scenario change; "cause path" drawn for an on-time flight. | PROPOSE FIX — auto-select the worst affected flight on every scenario change; path drawn only for affected flights. |
| R1-13 | Major | comprehension | Storm drag and resize not discoverable. | PROPOSE FIX — visible caption beside the storm, larger handle. |
| R1-14 | Major | comprehension | Board legend and spare rows off-screen. | PROPOSE FIX — legend sticky at the bottom of the board; spare rows pinned at the top. |
| R1-15 | Major | comprehension | Offline wording reads as broken ("No Gemini API key…"). | PROPOSE FIX — user-facing wording; the deployment must set the key. |
| R1-16 | Major | comprehension | Stand-in note for the organisers' Bengaluru–Kolkata example missing. | PROPOSE FIX — added to the flagship preset text. |
| R1-17 | Nit | codebase_details | Empty wave in flagship playback. | PROPOSE FIX — crew cancellation sits one wave after its cause. |
| R1-18 | Nit | codebase_details, design_critic | Cancelled flights expose "departure/arrival/delay" facts. | PROPOSE FIX — only the duty fact is issued for cancelled flights. |
| R1-19 | Nit | codebase_details | Aircraft-out-of-position depends on where a swap happens. | PROPOSE FIX — computed per aircraft from its last flown leg. |
| R1-20 | Nit | codebase_details | Standby crew report time follows the delayed departure. | PROPOSE FIX — 45 minutes before the scheduled departure, consistent with fixed report times. |
| R1-21 | Nit | codebase_details | Brief §6 wrongly says VT-DS05 and VT-DS15 have no out-and-back pair; two-hubs blurb overstates. | PROPOSE FIX — text corrected. |
| R1-22 | Nit | implementation_readiness, design_critic | Repo claims a pre-generated answer cache that does not exist. | PROPOSE FIX — claims removed; README gives a pre-demo check instead. |
| R1-23 | Nit | implementation_readiness, design_critic | Rate limit shared by both routes; 12/min may block judges on one network. | PROPOSE FIX — per route, 30/min. |
| R1-24 | Nit | implementation_readiness | `.gitignore` misses other env files; undo has a side effect inside a state updater; crisis JSON errors mislabelled. | PROPOSE FIX. |
| R1-25 | Nit | comprehension | Closure band hatching reads like "late"; storm tag covers labels; tilt and "×" unclear; wording ("5m", double negative, two play buttons); 12-hour time input; empty-state headline; dev badge; preset cards show no effect. | PROPOSE FIX for each. |
| R1-26 | Nit | design_critic | Server search not time-boxed; segment count and length unbounded; missing fact crashes the panel; engine version hand-set. | PROPOSE FIX for segment limits and safe rendering; engine version bumped. CONTEST time-boxing: the closure contract caps a request at four storms and the search is bounded (singles, pairs, triples of the top ten), measured at well under a second. |
| R1-27 | Nit | comprehension | Mobile: impact and presets sit below the board. | Recorded as accepted risk for this round (desktop is the demo surface); revisit if time allows. |
