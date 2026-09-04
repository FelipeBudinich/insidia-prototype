# Premium card-game UX implementation and QA record

Implemented against the [adopted UX specification](premium-card-game-ux-spec.md), with explicit amendments to the main specification §§18.2–18.3. The server remains the authority for rules, legal choices, private/public projection, outcomes, and deadlines. Protocol v1, empty private effect history, gameplay timers, and bot policy remain unchanged.

## Implementation boundaries

The client has a separate presentation director and bounded public cue/history pipeline. Every accepted snapshot updates current authority before presentation. A new local decision, a history gap, overload, reconnect, hidden-tab restoration, or a motion-preference change reconciles cosmetic work. The client never manufactures hidden card identities or authoritative resource changes.

The match uses responsive landscape layout and semantic controls sharing interaction state. Declaration and inspection retain table context. Ordered choices, target selection, pending state, selection reset, and deadline validation use the newest personalized projection. Reduced motion is a persistent preference with system support. Reconnect retains a frozen public table while withholding stale private data and commits. Results retain access to the public board and public history.

The dispatcher revalidates current action and decision identities, affordable Sin choices, eligible targets, prompt option membership, ordered-card count/uniqueness, connectivity, and deadline equality immediately on activation. Pending commands retain their original command ID and payload for retry. Origin-scoped feedback lets the initiating control show progress or rejection. Validation is UI guidance; the server still validates every command.

Home and lobby update existing DOM nodes in place. Directory and equivalent/configuration snapshots preserve focused field nodes, caret position, and unsaved host configuration. Create/join/configure/ready/start display inline pending or rejection messages. Start explains missing seats or the named humans who have not confirmed readiness. Native rules dialogs have a name, native modal focus behavior, Escape dismissal, focus return, preserved reading position, and suspension when a new local decision arrives; rules use a nonmodal drawer during decisions.

The developer runner is documented in [tools/ux/README.md](../tools/ux/README.md). It loads 101 real viewer-projection snapshots from 20 synthetic games, covering all eight Sins, all six Conspiracies, caught bluff, blocked Orgullo, Pereza with held-out proof, Lujuria returning the received card, terminal states, a real history-ring gap, Vanidad → Herejía, and a same-version issuer-only sealed acknowledgment. It imports the production renderer and presentation modules, supports pause/speed/reconnect/visibility testing, binds only to loopback, and does not send gameplay commands.

## Verification record

Checks completed during implementation:

- Dispatcher regression suite: seven passing tests covering stale authority, equality at deadline, duplicate activation, identical retries, affordability independent of hidden hand, ordered private choices, Herejía sealing/version rules, room command schemas, and reconnect refusal.
- Browser shell regression: passed in headless installed Chrome. Verified preserved input node/focus/value/caret through directory refreshes, preserved focused lobby select and unsaved value through presence/configuration refreshes, and modal rules suspension followed by nonmodal reopening and Escape dismissal.
- Replay regressions: coverage plus full/reduced-motion tests passed across all 101 accepted snapshots. Every presented public endpoint, authorized current hand/prompt, and private-reference exclusion was checked. The real truncated-history fixture reported one history gap and reconciled to the final authority.
- Fixture runner browser smoke: loaded the actual board and all 20 sequence final states at 1440×900, including disconnect/restoration, without JavaScript page errors. This is a smoke check, not a complete visual or accessibility review.
- Production build: client bake and TypeScript server compile passed. A local production-mode HTTP/WebSocket smoke check created and started a table, opened the declaration tray, rendered atlas-backed inspection, confirmed a declaration at 844×390, and produced no browser errors. The browser interaction suite passed at 1440×900, 1280×720, 1024×768 and 844×390; checks include declaration, keyed focus, card inspection/selection, ordered answers, equal-version sealing, expired controls, private cache removal and 44px minimum controls.
- Renderer checks include all 3–6-seat layouts, four-card hands, actual reveal-art bounds against resources, safe-area composition, public exposures, and anonymous hand placeholders after real store sanitization.
- The combined suite passed **106 project tests and 43 upstream tests (149 total)**. The additional interactive DOM suite also passed. The original proposal's baseline count is historical.

## Desktop profiling

A 60-second warm fixture profile used installed headless Chrome 152 on Apple M2 Pro, 1440×900 CSS pixels, DPR 1. The six-seat Herejía sequence repeatedly stepped through snapshots and reset rooms. Over 3,599 measured intervals, frame interval p95 was **17.5 ms** and p99 **17.8 ms**; board update plus canvas submission p95 was **1.8 ms** and p99 **2.3 ms**. No >50 ms long tasks were observed in the warm run. These are browser scheduling/submission measurements, not physical input-to-photon or mobile-device measurements. The preceding run including startup recorded one 51 ms long task; the warm run explicitly excluded two seconds of initial setup. Aggregate results are saved in [premium-ux-performance.json](premium-ux-performance.json).

## Acceptance work requiring measurement or human review

The numeric p95/p99 responsiveness, backlog, frame-pacing, and memory targets in the UX specification are acceptance targets. The desktop profile above covers one browser/device configuration; functional checks and bounded counters alone do not establish the remaining device targets. Perform profiled runs under 3–6-player load, high DPR, CPU throttling, network delay, rapid public reveals, hidden tabs, and prolonged play.

Physical touch devices, safe-area/notch behavior, screen-reader review (VoiceOver/NVDA), color/contrast review, and motion readability playtests have not been completed by these automated checks. Browser emulation is useful evidence for layout and activation, but does not replace those reviews. Full portrait gameplay, optional drag staging, richer private history, audio, and bot-policy tuning remain outside this initial implementation's adopted scope.
