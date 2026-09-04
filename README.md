# Insidia

Server-authoritative Insidia 2.2 for 3–6 human/bot players, built with TypeScript,
Express 5, WebSockets, the pinned Theseus canvas runtime, and Supabase Postgres.

Production: https://insidia2-fff10b5a3a38.herokuapp.com/

## Play

The landing page lists available public tables, followed by private tables, with
open human seats. Select a public table and enter your guest name to join; a
private table also asks for its six-digit code. Codes are never shown in the list.

Choose **Crear mesa** below the list to open the creation dialog. Tables default
to public, with private available as an option. The initial setup is a solo game
with zero additional humans and two bots; add human seats to invite others. In a
private table, share its code with your guests. Mark yourself ready and start.
Every human must be ready before the host can start. A refresh or reconnect
restores your seat.

The in-game rules cover all eight Sins and six Conspiracies. Every claim, shuffle,
challenge, counter, choice, timeout, cleanup and victory is resolved by the server.

## Development

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Without `DATABASE_URL`, development uses explicitly
ephemeral memory storage. To test durable storage, use `.env` with a Supabase
**session-mode** pooler connection (port 5432), a stable 32-byte base64 `APP_SECRET`,
and `PUBLIC_ORIGIN=http://localhost:3000`. The development server loads `.env`.
Never point two running servers at the same schema: a database advisory lock
deliberately enforces one authoritative owner.

```sh
npm test
npm run build
```

Tests cover the gameplay rules, 100 seeded complete bot matches, private
projections, session/lobby lifecycle, idempotency, encrypted record authentication,
real HTTP/WebSocket clients, socket replacement, and the vendored engine's runtime.
The source browser and production bundle were also exercised in Chrome.

## Deployment and storage

Heroku runs `npm run build` during slug compilation. The release process verifies
the separately applied schema version; application startup never executes DDL.

```sh
heroku git:remote -a insidia2
git push heroku HEAD:main
```

Heroku config must contain `DATABASE_URL`, `APP_SECRET`, and
`PUBLIC_ORIGIN=https://insidia2-fff10b5a3a38.herokuapp.com`.
Keep one web dyno. `/healthz` reports HTTP liveness; `/readyz` reports completion
of database ownership and recovery. Production refuses to use memory storage.

Supabase project: `vqztqvpongkhttkjmgsz` (`insidia-v1`). Only the private `insidia2`
schema is used. Its dedicated `insidia2_server` login has access to that schema;
`anon`, `authenticated`, and `PUBLIC` have none. All tables have RLS enabled.
The browser receives neither Supabase keys nor database access. TLS validates
Supabase's published root CA, vendored in `server/security/certs/`.

Snapshots, event bodies, session records, receipts, sealed decisions and fault
evidence use AES-256-GCM with record-bound associated data and a durable nonce
ledger. Purpose-separated HMAC keys protect session digests, command digests,
private-code lookup and card references. Keep `APP_SECRET` unchanged across
releases and retain it with database backups: lost keys make saved games unreadable.

## Code map

- `server/domain/`: rules, cards, phases, continuations and invariants.
- `server/application/`: serialized command processing, bots and deadlines.
- `server/projection/`: explicit allowlists for player-specific views.
- `server/persistence/`: Supabase transactions, fences, encryption and event chain.
- `server/transport/`: guest cookies, WebSockets, limits and static route allowlist.
- `shared/protocol/`: strict command schemas; browser ESM generated at build time.
- `public/games/insidia/`: Spanish UI and the single long-lived Theseus game.
- `vendor/theseus/`: source provenance, license and upstream test references.

Theseus is pinned at `a6c5535cd99eaf2ebabdf09d26d286ca5de85287`.
The selected upstream runtime suites are release gates. Upstream sample games,
the two documented autorunner failures, and filesystem-writing authoring tools
are excluded from this game's release; their reference tests are retained.
`ig-debug.test.mjs` has only its relative source path adjusted for this repository.

## Specification coverage

The playable rules, rooms, guest sessions, private views, bots, persistence and
reconnect flows are implemented. The specification also defines an unusually
detailed versioned persistence/provenance format. This implementation uses a
smaller encrypted record/event model, not all of those exact physical schemas.
In particular, full service-lifetime identity allocation tombstones, reciprocal
receipt provenance constraints, format upcasters/fallback replay, and the formal
guarded scheduler-token protocol are not implemented. Do not treat the current
release as certified conformance to acceptance criteria 14–20 in their entirety.
