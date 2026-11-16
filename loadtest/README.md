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
Set `$env:WARM_UP="1"` before running k6 for the warm run. Leave it unset for the cold run. The comparison results are not yet recorded.

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

- **Run**: 500 VUs, 30 s ramp, 90 s hold, 15 s ramp down, against one 50-seat showtime.
- **Verified**: 50 of 50 seats held, 0 duplicate holds, 0 database double-bookings, waiting-room active set at 300 of limit 300.
- **k6 counters**: tokens_loaded 500, holds_ok 104, seat_conflicts 28766, waiting_room_hits 128, waiting_room_admitted 1, rate_limited 0, network_errors 31953 (all EOF). The k6 threshold on network_errors failed.

---

## 4. Known Limits

- EOF cause is not confirmed. Leading hypothesis: cold in-memory session cache, so many Argon2id verifies queue behind ARGON2_MAX_CONCURRENCY=4 and requests stall past the 10 s connectionTimeout. Marked as a hypothesis.
- Measured on this machine (server/scripts/loadtest-argon2-timing.ts): Argon2id verify takes about 104 ms median (p95 about 119 ms), and throughput is about 11 to 12 verifies per second at concurrency 4 and 8. During the 30 s ramp about 16.7 new sessions per second arrive. These are measured numbers. The conclusion that this causes the EOFs is inferred.
- The session cache TTL is absolute at 60 s and a cache hit does not extend it (session.ts), so a warmed cache expires 60 s after warming.
- Only 1 queued user was admitted. Inferred: slots refresh while losing users keep retrying. Not verified.
- Sign-in surge of about 8 per second drops connections.
- The per-user hold limit (default 10 per minute) was raised for the test through $env: variables set in the API window before npm run dev. They are never put in .env.
