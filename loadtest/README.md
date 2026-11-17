# A VUE 500-VU Seat Hold Race & Waiting Room Load Test

Local load test proving the atomic seat-hold system and waiting-room under 500 concurrent users competing for 50 seats in the VIP hall.

---

## 1. Prerequisites

### Check k6 Installation
Ensure `k6` is installed and available in your PowerShell path:
```powershell
k6 version
```
If not installed, install via:
```powershell
winget install k6 --source winget
```

---

## 2. Test Execution Lifecycle (PowerShell)

### Step 1: Configure the API Server Window (Before Starting Server)
Before starting the backend API server, set the hold rate-limit overrides directly as `$env:` variables in the API's PowerShell terminal window. **Never put these in `.env`**:

```powershell
# Set in the API server window BEFORE running npm run dev:
$env:RATE_LIMIT_HOLD_USER = "100000"
$env:RATE_LIMIT_HOLD_IP = "100000"
$env:RATE_LIMIT_AUTH_IP = "100000"  # needed for the warm-up: GET /auth/me allows 30 per minute per IP by default

# Optional: for the waiting-room demo, shorten slot TTL (default 90 s):
# $env:WAITING_ROOM_SLOT_SECONDS = "20"

# Note: GET /showtimes/:id/waiting-room has no rate limiter attached, so no waiting room override is required.
# Start the server in that same terminal:
npm run dev
```

### Step 2: Set Test Environment Variables (In Load-Test Window)
In your load-testing PowerShell terminal, generate an 18-byte cryptographically secure password (base64 with `+/=` removed), point the tokens file to `$env:TEMP`, and define test parameters:

```powershell
# Cryptographically generated 18-byte password (base64 with +/= removed)
$bytes = [byte[]]::new(18)
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$env:LOADTEST_PASSWORD = [Convert]::ToBase64String($bytes) -replace '[+/=]', ''

# Tokens file MUST be outside the repository folder:
$env:LOADTEST_TOKENS_FILE = "$env:TEMP\loadtest-tokens.json"

$env:SHOWTIME_ID = "<50-seat-showtime-uuid>"
$env:API_URL = "http://127.0.0.1:3000"
```

### Step 3: Clean, Seed Users, and Pre-Mint Session Tokens
Run initial cleanup, seed 500 user accounts with Argon2id, and pre-mint authenticated sessions to `$env:LOADTEST_TOKENS_FILE`:
```powershell
cd server

# 3a. Clean any lingering state
npx tsx scripts/loadtest-cleanup.ts $env:SHOWTIME_ID

# 3b. Seed 500 load-test users (loadtest+1..500@loadtest.invalid)
npx tsx scripts/loadtest-seed.ts

# 3c. Pre-mint 500 session tokens using the app's createSession() helper
npx tsx scripts/loadtest-tokens.ts

cd ..
```

### Step 4: Run k6 Load Test
Ramps to 500 concurrent VUs over 30s, sustains contention for 90s, and ramps down over 15s. Each VU uses its own pre-minted session token (no live sign-ins):
```powershell
k6 run -e LOADTEST_TOKENS_FILE=$env:LOADTEST_TOKENS_FILE -e SHOWTIME_ID=$env:SHOWTIME_ID -e API_URL=$env:API_URL loadtest/hold-race.js
```

#### Cold versus warm run
Set `$env:WARM_UP="1"` before running k6 for the warm run. Leave it unset for the cold run.

#### Optional flags
- `$env:IDLE_AFTER_CONFLICT_SECONDS="<seconds>"` — pause each VU this many seconds after a 409 seat conflict (default 0, which keeps the original 0.5 s sleep). For the waiting-room demo, set this **longer** than `WAITING_ROOM_SLOT_SECONDS` so idle users' slots expire and queued users get admitted.
- `$env:WAITING_ROOM_SLOT_SECONDS="<seconds>"` — set in the **API server window** (not k6) to shorten the waiting-room slot TTL (default 90 s). See Run 3 below.

### Step 5: Verify System State Post-Run
Run the verification script from the `server` directory so it accurately discovers `server/.env` (running from the root fails because `.env` is located inside `server/`):

```powershell
cd server
npx tsx ../loadtest/verify.ts $env:SHOWTIME_ID
cd ..
```

*(Alternative manual verification commands)*:
- **Redis hold count**: `redis-cli KEYS "hold:$env:SHOWTIME_ID:*"`
- **Redis waiting room active**: `redis-cli HLEN "wr:$env:SHOWTIME_ID:active"`
- **Postgres double-booking check**:
  ```sql
  SELECT seat_id, count(*) FROM bookings WHERE showtime_id = '<showtime_uuid>' AND status = 'confirmed' GROUP BY seat_id HAVING count(*) > 1;
  ```

### Step 6: Clean Up Test Data
Removes all 500 test accounts, their sessions, holds, and waiting room keys:
```powershell
cd server
npx tsx scripts/loadtest-cleanup.ts $env:SHOWTIME_ID
cd ..

# Optional: remove the temporary tokens JSON file
Remove-Item -Path $env:LOADTEST_TOKENS_FILE -ErrorAction SilentlyContinue
```

---

## 3. Results

Common setup: 500 VUs, 30 s ramp, 90 s sustain, 15 s ramp-down, one 50-seat showtime. Hold and auth rate limits raised through `$env:` in the API window only (never in `.env`). Sessions pre-minted; Argon2id seed.

### Run 1 — Cold (API restarted, empty session cache)

| Counter | Value |
|---------|------:|
| tokens_loaded | 500 |
| warm_ok / warm_failed | 0 / 0 |
| holds_ok | 141 |
| seat_conflicts | 48 310 |
| waiting_room_hits | 200 |
| waiting_room_admitted | 0 |
| waiting_room_timeouts | 0 |
| rate_limited | 0 |
| server_busy | 3 603 |
| server_errors | 0 |
| network_errors | 0 |
| iterations | 52 054 complete, 200 interrupted |

No threshold crossed.

### Run 2 — Warm (`WARM_UP=1`; warm-up 46 s for 500 sessions, ≈10.9/s)

| Counter | Value |
|---------|------:|
| warm_ok / warm_failed | 500 / 0 |
| holds_ok | 167 |
| seat_conflicts | 68 484 |
| waiting_room_hits | 200 |
| waiting_room_admitted | 0 |
| waiting_room_timeouts | 195 |
| rate_limited | 0 |
| server_busy | 0 |
| server_errors | 0 |
| network_errors | 0 |
| iterations | 68 846 complete, 5 interrupted |

No threshold crossed.

### Run 3 — Waiting-room demo (warm; API `WAITING_ROOM_SLOT_SECONDS=20`; k6 `IDLE_AFTER_CONFLICT_SECONDS=25`)

| Counter | Value |
|---------|------:|
| holds_ok | 41 |
| seat_conflicts | 1 950 |
| waiting_room_hits | 1 651 |
| waiting_room_admitted | 1 651 |
| waiting_room_timeouts | 0 |
| rate_limited | 0 |
| server_busy | 0 |
| server_errors | 0 |
| network_errors | 0 |
| iterations | 1 904 complete, 87 interrupted |

No threshold crossed.

### Verification (taken right after each run)

All three runs PASS: 50 active holds, 50 of 50 seats, 0 duplicate holds, 0 database double-bookings. Waiting-room active: 300 of 300 (Runs 1–2), 299 of 300 (Run 3). 0 bookings were confirmed, so the database unique constraint was not exercised.

---

## 4. Notes

- **Measured:** `server_busy` = 503 SERVER_BUSY (designed bounded-wait response with `Retry-After`). Cold run: no dropped connections, no other 5xx.
- **Measured:** Argon2id verify ≈104 ms median, ≈11–12 verifies/s at concurrency 4 and 8.
- **Inferred:** the 503s in the cold run come from the cold session cache (500 first-time Argon2id verifies); the cause is not isolated between sliding cache, bounded wait and counter fix.
- **Inferred:** `holds_ok` counts requests, not seats (one hold request can cover up to 6 seats); do not read it as a seat count.
- **Inferred:** waiting-room counters are events, not unique users.
- **From code:** waiting-room slots are sliding (every hold request refreshes an active user's slot), so users who keep retrying never free a slot; Runs 1–2 therefore admit no one. Run 3 shows admission when users idle past the slot time.
- **From code:** session cache is sliding (idle 60 s, hard cap 300 s) and per server instance; on serverless an eviction on one instance does not reach others.
- **Not tested:** more than one showtime, multi-instance, non-local network, confirmed bookings, the app's retry UX for SERVER_BUSY.

### Earlier runs

Runs before the session-hardening and counter fix used a network-error counter that also counted 409/429 responses, so their `network_errors` figures are not valid and are not cited here. Seat-safety checks in those runs passed.
