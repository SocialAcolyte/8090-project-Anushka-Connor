# Decisions (Fri Nov 13, ~9 PM)

What we agreed so the scope stops growing. Anushka's behavior-contract proposal in the README stays; this file says how it fits.

## The project in one sentence

Forward Deployed 8090 watches how a legacy system is actually used, for longer than any video could cover, turns that into executable behavior contracts, and proves a rebuild still satisfies them.

Pitch: "We turn how people actually use software into executable contracts, so coding agents can rebuild it without silently losing the business rules."

## One surface: a CLI, also exposed as an MCP server

| Command | Input | Output |
| --- | --- | --- |
| `watch` | Legacy app source | An agent reads the code, chooses which business operations to probe, and installs probes inside the app. Probes log events and state changes for days or weeks. A recorder captures sampled sessions as video, timestamped to the event log. |
| `contract` | Watch log + clips | Workflows clustered from the long-term log, with counts and variants. One behavior contract per workflow, marking what was observed, inferred, approved and unknown. |
| `verify` | Contracts + old app + new app | The behavioral linker replays the same scenarios on both apps, compares business outcomes and state, and attaches a short video diff as evidence. Pass, fail or blocked per contract. Failures go to the repair agent. |

## Why the watcher lives inside the software

- Legacy systems are not used like SaaS apps. Month-end, quarter-end and one-off workarounds never show up in a single recording.
- Models lose coherence over long video, even cut and edited. A structured event log is cheap to store and easy to reason over across weeks.
- Video stays, but only as sampled evidence linked to events.
- In-app probes record side effects, retries and state, which is the evidence the contracts need and video cannot provide.

## Roles

- **Connor:** `watch` and `contract`. REA reads the legacy code to decide what to probe.
- **Anushka:** `verify`. The behavioral linker, video diff and repair loop.

## Rules we keep

- Acceptance checks live outside the repair agent's reach, so it cannot edit the tests to pass.
- Verification runs live. Any prebuilt generation or repair is labelled as prerecorded.
- The demo apps are synthetic. Nothing real or proprietary.

## Out of scope (mention as "next" only)

- Building the rebuild engine. Claude Code or Software Factory rebuilds from the contracts.
- Chrome extension and desktop agents.
- Fusion (composing several systems) and a third implementation.
- A web UI. Output is the CLI plus one HTML report per run.

## The demo

Target: `fixtures/legacy-plant`, a synthetic late-90s plant maintenance-ordering app.

Hidden rule: enterprise accounts get a negotiated rate (Fermi Station 10%, Hansen Plant 15%). It must hold on the common single-order flow **and** the rare month-end bulk-approval flow. The UI never shows the rate.

1. **Watch:** three simulated weeks of usage. Single orders appear hundreds of times; month-end bulk approval appears once per account.
2. **Contract:** the negotiated-rate contract, with evidence from both flows and one ambiguity a person approves.
3. **Verify:** the rebuilt app keeps the rate on single orders but drops it on month-end bulk approval, the flow only the watcher saw. The contract catches it.
4. **Repair:** the coding agent patches it and the rerun passes.
5. **Stretch:** lost response plus retry, checked against records for exactly one order and one charge.

Headline: "6 of 6 contracts pass after repair."
