# A VUE

> **A view. Your view. Our view.**  
> A high-concurrency cinema ticket booking application built to prove enterprise-grade mobile UI polish and zero double-booking correctness under peak traffic spikes.

*Search aliases: A VUE (also written A View or AVUE).*

---

## Media & Demonstration (Owner-Supplied Placeholders)

- **Product Demo Video**: `[OWNER-SUPPLIED: Link to <3 minute walkthrough video]`
- **App Motion Teaser (GIF)**:  
  ![A VUE Mobile App Walkthrough](https://raw.githubusercontent.com/owner/avue/main/docs/assets/demo-placeholder.gif)  
  *(Placeholder: Owner to supply final 5.5s motion GIF demonstrating seat selection, payment simulation, and QR ticket issuance)*
- **Android Dev Build Download**: `[OWNER-SUPPLIED: Expo EAS dev build .apk download link]`
- **Figma Design System**: `[OWNER-SUPPLIED: Link to official A VUE Figma canvas]`

---

## 1. Architectural Highlights

- **Zero Double-Booking Guarantee**: Proven by automated k6 load tests with 500 virtual users competing simultaneously for the same 50 seats.
- **Two-Tiered Concurrency Engine**:
  - **Tier 1 (Redis)**: Sub-millisecond atomic multi-seat reservation using custom Lua scripts (`HOLD_SEATS_LUA`), compare-and-delete release, and automated 600-second expiration.
  - **Tier 2 (Postgres Engine)**: Hard database constraint `UNIQUE(showtime_id, seat_id)` acting as the ultimate mathematical safety net.
- **Traffic Smoothing Waiting Room**: Serverless lazy queue admitting users at 5 users/sec when active viewers on a showtime exceed 100 concurrent sessions.
- **Payment & Webhook Reliability**:
  - Flutterwave test-mode integration with mandatory server-side `Idempotency-Key` tracking.
  - Constant-time signature verification (`crypto.timingSafeEqual`) per approved security exceptions.
  - Automated detection of late-webhook race conditions with instant ledger auto-refunds.
- **Security & Data Privacy**:
  - Password hashing with Argon2id; zero plain tokens or passwords in Redis.
  - QR codes contain an opaque random $\ge 128$-bit reference; only its SHA-256 hash is persisted in the database.
  - Zero user data transmitted to Google or third parties; self-hosted fonts and strict proxy isolation.

---

## 2. Tech Stack

- **Mobile App**: React Native (Expo Dev Client) + TypeScript, Reanimated, Android target (`app.avuemovies`), WCAG 2.1 AA accessible.
- **API Server**: Node.js + TypeScript + Fastify, plain `pg` with PgBouncer transaction pooling, Redis (`ioredis`), Vitest.
- **Database & Storage**: PostgreSQL (Neon in production, Docker locally), Redis (Upstash in production, Docker locally).
- **Payment Processor**: Flutterwave (Test Mode).
- **Movie Data**: TMDB API via backend isolation proxy (client never contacts TMDB directly).

---

## 3. Documentation Index

- [TRAFFIC.md](TRAFFIC.md) — Comprehensive concurrency, hold lifecycle, polling vs WebSockets, and Redis fail-closed policies.
- [SHARDING.md](SHARDING.md) — Horizontal partitioning strategy, shard key selection, and blockbuster hot-shard mitigations.
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — System topology, connection pooling rationale, read/write routing, and TMDB cache TTL matrix.
- [COMPONENTS.md](COMPONENTS.md) — Design token catalog, component states, and accessibility specifications.
- [LEARNING-LOG.md](LEARNING-LOG.md) — Engineering log documenting key technical decisions, benchmark findings, and tradeoffs.
- [Architecture Decision Records (ADRs)](docs/decisions/) — Formal decision records for posters, caching, late webhooks, and polling.

---

## 4. Local Development Quickstart

### Prerequisites
- Node.js >= 20.x
- Docker Desktop (for local Postgres and Redis)

### Backend Setup
```powershell
cd server
npm install
# Start local containers
docker compose up -d
# Run database migrations
npm run migrate
# Seed demo cinemas and showtimes
npx tsx scripts/seed.ts
# Start development server
npm run dev
```

### Mobile App Setup
```powershell
cd app
npm install
npx expo start --dev-client
```

