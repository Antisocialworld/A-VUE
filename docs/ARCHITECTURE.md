# A VUE — System Architecture (`ARCHITECTURE.md`)

This document outlines the system architecture, caching strategies, and security invariants for **A VUE** (cinema-ticket booking application).

---

## 1. TMDB Caching Architecture & TTL Decisions

TMDB movie data is accessed strictly through the Fastify backend; the mobile app never makes direct requests to TMDB or its image CDN. All responses are parsed with Zod, mapped to clean internal DTOs, and cached in Redis with a dual fresh/stale strategy.

### 1.1 Cache TTL Matrix

| Cache Key | Tier | TTL | Decision & Rationale |
|---|---|---|---|
| `tmdb:list:${page}` | Fresh | 10 min (600 s) | Now-playing titles update periodically throughout the day; a 10-minute fresh window reduces upstream calls while reflecting new releases promptly. |
| `tmdb:list:${page}:stale` | Stale Fallback | 24 h (86,400 s) | Retains the list catalogue to keep the browsing surface functional with `stale: true` during TMDB outages or network timeouts. |
| `tmdb:movie:${id}` | Fresh | 60 min (3,600 s) | Movie metadata (runtime, genres, synopsis) is immutable once scheduled, making a 1-hour cache ideal for high traffic. |
| `tmdb:movie:${id}:stale` | Stale Fallback | 7 days (604,800 s) | Static movie details remain accurate for extended periods, providing reliable fallback data even during prolonged upstream degradation. |
| `/movies/poster/:size/:file` | Edge & Client HTTP | 24 h (86,400 s) | TMDB poster image filenames are deterministic content hashes; aggressive HTTP caching (`Cache-Control: public, max-age=86400`) avoids redundant downloads. |

---

## 2. Upstream Resilience & Rate-Limit Strategy

- **Single-Flight Concurrency**: Concurrent identical requests share a single in-flight promise (`singleFlight`), preventing cache-stampede load on TMDB.
- **429 Rate-Limit Handling**: On upstream `429 Too Many Requests`, the server inspects the `Retry-After` header. If $\le 5\text{ s}$, the request waits and retries once; if $> 5\text{ s}$ or retry fails, the server falls back immediately to stale cache without causing retry storms.
- **Graceful Error Envelope**: When no fresh or stale data is available, endpoints return a safe 503 (`SERVICE_UNAVAILABLE`) error envelope without leaking token or host details.

---

## 3. Database Connection Pooling Configuration & Rationale

### 3.1 Serverless Concurrency & Pool Sizing
A VUE deploys its Fastify API on Vercel Serverless with PostgreSQL on Neon. In a serverless environment, each concurrent function invocation can spawn its own process. If every serverless instance opened 10–20 direct connections, a traffic spike of 500 virtual users would attempt to open 5,000+ connections, overwhelming Postgres connection limits.

### 3.2 Pooling Architecture
- **Instance Pool Cap**: Each Fastify serverless instance configures `max: 1–2` connections in `server/src/lib/db.ts`.
- **PgBouncer Transaction Mode**: The application connects via Neon's pooled connection string (`DATABASE_URL`). PgBouncer operates in **transaction mode**:
  - Connections are held only for the duration of a transaction block (`BEGIN` ... `COMMIT`).
  - Once the transaction completes, the connection is returned to the global serverless pool in milliseconds.
  - Invariant rules enforced: No `LISTEN`/`NOTIFY`, no temporary tables, no session-level `SET` commands, and no session-level advisory locks.
- **Direct Migrations URL**: Schema migrations and batch operations use `DATABASE_DIRECT_URL`, bypassing PgBouncer to execute DDL safely.

---

## 4. Read/Write Split Routing & Read-Your-Own-Writes Design

### 4.1 Topology
- **Writer Pool**: Points to the primary Postgres instance (`DATABASE_URL`). All mutations (`INSERT`, `UPDATE`, `DELETE`) and transactional booking workflows are routed here.
- **Reader Pool**: Points to read replica instances (`DATABASE_READ_URL`). Defaults to the writer pool when running in single-node or local Docker environments.

### 4.2 Read-Your-Own-Writes Consistency (Redis Pinning)
Replication lag between Postgres primary and read replicas is typically 10–100ms. If a user completes checkout and immediately views their booking list on the Profile screen, querying an asynchronous replica could result in an empty list ("Where is my ticket?").

To solve this while maximizing read replica offloading:
1. Upon completing any write transaction (e.g. checkout, booking confirmation, password change), the server sets a short-lived Redis key:
   `SET user:{userId}:write_pin 1 EX 10` (10-second TTL).
2. When executing read queries, the data layer checks for the presence of this pin:
   - **Pin Active**: Routes the user's reads directly to the **Writer Pool**, guaranteeing that the user sees their own committed transactions immediately.
   - **Pin Expired / Inactive**: Routes read traffic to the **Reader Pool**, distributing load away from the primary database.


