# Decisions (Fri Nov 13, ~9:30 PM)

What we agreed so the scope stops growing. Anushka's behavior-contract proposal in the README stays; this file says how it fits.

## The project in one sentence

Forward Deployed 8090 learns how a legacy system is really used from its own logs and data, turns that into business-rule contracts a person approves, and proves a coding agent's rebuild keeps them, while people steer the changes they want by recording themselves using the app.

Pitch: "We turn how people actually use software into executable contracts, so coding agents can rebuild it without silently losing the business rules."

## Headline result (the A/B)

The same coding agent rebuilds the legacy app twice:

- **Baseline:** from the code and a screen recording, the way teams do it today.
- **With us:** from our contracts, checked by `verify`.

We report how many business rules each version keeps, for example "Baseline kept 4 of 6 rules. With contracts, 6 of 6." Nothing is staged: the baseline's bugs are its own.

## Two channels of evidence

| Channel | Source | What it decides | Checked by |
| --- | --- | --- | --- |
| **Internal logs** | Database history, audit tables, request logs | Foundational behavior: prices, records, side effects, retries, rare flows like month-end | Machines (`verify`) |
| **Annotated video** | A person records the screen while talking and pointing with the cursor | What should change, what is broken, what must stay exactly as it is | People, then the repair agent |

## One surface: a CLI with JSON output

| Command | Input | Output |
| --- | --- | --- |
| `watch` | A running legacy system | An agent chooses which tables, logs and endpoints to watch, at the boundaries, with no changes to the legacy code. It backfills from existing history on day one (last month's month-end runs are already in the database), then keeps watching. |
| `contract` | Watch data | Workflows grouped from the log, with counts. One behavior contract per workflow, marking what was observed, inferred, approved and unknown. |
| `annotate` | A Monet Shot recording folder (`.reel`) | Transcript of the narration (ElevenLabs speech-to-text), lined up with exact pointer positions and clicks from the recording's `cursor.json`, plus frames cropped where the person pointed. Each note becomes a **change** (approved contract change), a **bug** (sent to the repair agent) or a **keep** (behavior confirmed). |
| `verify` | Contracts + old app + new app | The behavioral linker replays the same scenarios on both apps and compares business outcomes and state. Pass, fail or blocked per contract. Failures go to the repair agent. |

Every command can print `--json`, so a coding agent can drive it from the shell. An MCP wrapper is "next", not tonight.

## Roles

- **Connor:** `watch` and `contract`.
- **Anushka:** `verify` (linker and repair loop) and `annotate`.
- **First hour, together:** agree and commit the contract JSON schema with one hand-written example. It is the seam between both halves.

## Rules we keep

- Acceptance checks live outside the repair agent's reach, so it cannot edit the tests to pass.
- `verify` runs live in the demo. Rebuilds and repairs are recorded runs, labelled as recorded.
- The demo apps are synthetic. Nothing real or proprietary.
- **Monet Shot: approved by the organizers** (Fri Nov 13, 9:05 PM). Use it.
- **REA: cleared to use.**

## Recording input: Monet Shot

[Monet Shot](https://github.com/SocialAcolyte/monet-shot) is Connor's open-source macOS screen recorder (MIT, public since Oct 31, 2026, installable with Homebrew). The organizers approved using it on Fri Nov 13. We use it as an installed tool, the same as any open-source dependency, list it in the README with its license, and say plainly that it's Connor's. We do not copy or rebuild its code here.

Each recording is a `<name>.reel/` folder:

| File | Contents | How `annotate` uses it |
| --- | --- | --- |
| `screen.mov` | The screen, recorded without the system cursor | Clean frames to crop at the pointer position |
| `cursor.json` | `{ samples: [{t, x, y}], clicks: [{t, x, y}] }`, positions scaled 0–1 to the frame | Exactly where the person pointed or clicked at each moment. A circling gesture is a loop in `samples`, found with simple geometry, not a vision model |
| `voice.m4a` | The narration | Sent to ElevenLabs speech-to-text, then lined up with `cursor.json` by timestamp |
| `meta.json` | Pixel size, scale, duration, and the offset of the voice file | Converting coordinates and aligning audio with video |

New code we write: reading the `.reel` folder, detecting pointing and circling, aligning it with the transcript, and turning each note into a change, bug or keep.
