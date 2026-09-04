# Local UX fixture runner

Run `npm run dev:ux` (or `node tools/ux/serve.mjs`), then open <http://127.0.0.1:8789>. The server binds only to loopback and is separate from the production server and client bake. Set `UX_PORT` to choose a different local port.

The runner uses the production board, semantic interaction layer, client store, and presentation director. No WebSocket is opened, and visual interaction cannot commit commands. Use **Un snapshot** to inspect the next authoritative fixture. **Reproducir/Pausar** starts or pauses the virtual motion clock; speed choices include a 20× burst. Use the normal game motion preference to compare full and reduced motion. **Ocultar/restaurar** exercises visibility catch-up. **Desconectar** freezes the public table; **Restaurar conexión** then changes the projection epoch and restores the current authority. **Omitir hasta el final** exercises snapshot catch-up; a real history gap requires missing effect sequence numbers, not merely skipped projections.

There are 20 sequences (101 viewer snapshots), covering every Sin and every Conspiracy:

- Three seats: bank payout, declaration, truthful proof, exposure.
- Four seats: Envidia, four-card hand, ordered return.
- Six seats: Vanidad → Herejía, direction, issuer-only sealed acknowledgment, timeout rotation.
- Every remaining Sin and all six Conspiracies, including an affordable Indigencia choice and Perfidia after an actual exposure/refill.
- Caught bluff, blocked Orgullo, Orgullo victory, Pereza's held-out proof during counters, and returning Lujuria's newly received card.
- Frozen abandonment, grouped elimination, draw, and a genuine 60-effect history-ring gap after 75 missed turns.

Regenerate with `npm run generate:ux-fixtures`. The builder starts synthetic domain games, checks domain invariants before every captured snapshot, and serializes only `server/projection/project.ts` output for viewer 0. Canonical room data, deck order, sealed rows, internal card IDs, session credentials, and the other players' private hands are not saved. The saved viewer's own hand is intentional, just as in a real personalized protocol snapshot. Fixtures contain no real users or sessions.

Run `node --import tsx --test test/ux-command*.test.ts` for dispatcher, shell, coverage, and full/reduced-motion replay regressions. Replay checks every public endpoint, current local hand/prompt, and cosmetic privacy boundary across all 101 snapshots. Group-elimination/draw setups seed the same internal conditions as the existing domain tests, then capture only the validated cleanup result. Browser checks use installed Chrome on macOS, `UX_BROWSER_PATH`, or an installed Playwright Chromium; they report an explicit skip when no executable is available.

Suggested visual checks: resize to 1440×900 and 844×390; inspect each sequence at 1× and 0.25×; open rules/inspection during a decision; select and reorder Envidia's cards; restore a hidden sequence at 20×; change motion preference during a reveal. Use browser profiling for actual frame and interaction measurements. Fixture playback alone does not establish target-device p95 or p99 performance.

With the fixture server running, `npm run test:ux` runs the interactive DOM regression suite in installed Chrome. Set `INSIDIA_TEST_URL` if using another server origin.
