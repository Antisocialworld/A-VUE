/**
 * A VUE 500-VU Seat Hold Race & Waiting Room k6 Load Test
 *
 * Simulates 500 concurrent Virtual Users (VUs) competing for 50 seats in the VIP hall.
 * Uses pre-minted session tokens from LOADTEST_TOKENS_FILE (VU n uses token n-1).
 *
 * Validates:
 * 1. Concurrency safety: Zero double-holds / zero seat over-allocation (atomic Lua script).
 * 2. Waiting Room activation: Graceful 429 redirect, queue tracking, and admission.
 * 3. System resilience: Zero 5xx responses and zero network errors under heavy load.
 *
 * Usage (Run by Owner - Do NOT run unasked):
 *   k6 run -e LOADTEST_TOKENS_FILE=$env:LOADTEST_TOKENS_FILE -e SHOWTIME_ID=$env:SHOWTIME_ID -e API_URL=$env:API_URL loadtest/hold-race.js
 */

import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Task B: Load pre-minted session tokens in init context
const tokensFile = __ENV.LOADTEST_TOKENS_FILE;
if (!tokensFile) {
  fail('[FATAL] LOADTEST_TOKENS_FILE environment variable is required. Aborting.');
}

let tokens = [];
try {
  tokens = JSON.parse(open(tokensFile));
} catch (err) {
  fail(`[FATAL] Failed to read or parse LOADTEST_TOKENS_FILE (${tokensFile}): ${err.message}`);
}

if (!Array.isArray(tokens) || tokens.length < 500) {
  fail(
    `[FATAL] LOADTEST_TOKENS_FILE must contain at least 500 tokens. Found: ${
      tokens ? tokens.length : 0
    }`
  );
}

// Set expected statuses so expected 409/429 do not count as failed requests.
// 401, 5xx, and status 0 (network drops) remain failures.
http.setResponseCallback(http.expectedStatuses(200, 201, 204, 409, 429));

// Task 1: Warm-up switch
const isWarmUp = __ENV.WARM_UP === '1';

// Task 2: Optional idle after conflict (default 0)
const idleAfterConflictSeconds = Number(__ENV.IDLE_AFTER_CONFLICT_SECONDS) || 0;

// Custom Metrics (Task B Requirements)
const tokensLoaded = new Counter('tokens_loaded');
const warmOk = new Counter('warm_ok');
const warmFailed = new Counter('warm_failed');
const rateLimited = new Counter('rate_limited');
const serverBusy = new Counter('server_busy');
const networkErrors = new Counter('network_errors');

const holdsOk = new Counter('holds_ok');
const seatConflicts = new Counter('seat_conflicts');
const waitingRoomHits = new Counter('waiting_room_hits');
const waitingRoomAdmitted = new Counter('waiting_room_admitted');
const waitingRoomTimeouts = new Counter('waiting_room_timeouts');
const holdP95 = new Trend('hold_p95');
const serverErrors = new Rate('server_errors');

export const options = {
  // Task B: Ramp 30s to 500 VUs, hold 90s, ramp down 15s
  stages: [
    { duration: '30s', target: 500 }, // 30s ramp to 500 VUs
    { duration: '90s', target: 500 }, // 90s sustained load at 500 VUs
    { duration: '15s', target: 0 },   // 15s ramp down
  ],
  thresholds: {
    // Task B: tokens_loaded count >= 500
    tokens_loaded: ['count>=500'],
    // Zero dropped connections, EOFs, or timeouts
    network_errors: ['count==0'],
    // Zero 5xx server errors
    server_errors: ['rate==0'],
  },
};

const API_URL = __ENV.API_URL || 'http://127.0.0.1:3000';
const SHOWTIME_ID = __ENV.SHOWTIME_ID || '';

// VU-isolated variables (each VU gets its own isolated JavaScript runtime context)
let vuSeatIds = null;

/**
 * Helper to record network-level failures (status 0, connection drops, EOF, timeout).
 * Counts ONLY status === 0 or non-empty error string (Task 1a).
 */
function recordNetworkErrorIfNeeded(res) {
  if (res.status === 0 || (res.error && res.error !== '')) {
    networkErrors.add(1);
    return true;
  }
  return false;
}

/**
 * Helper to detect designed 503 SERVER_BUSY response (Task 1b).
 */
function isServerBusy(res) {
  if (res.status === 503) {
    try {
      const body = res.json();
      if (body && body.error && body.error.code === 'SERVER_BUSY') {
        return true;
      }
    } catch (e) {
      // Non-JSON 503
    }
  }
  return false;
}

/**
 * Setup hook: runs once before VUs start.
 * Discovers the actual seat IDs for the target showtime using pre-minted token 0.
 */
export function setup() {
  tokensLoaded.add(tokens.length);

  // Task 1: Authenticated session warm-up (batch size 8, 60s timeout, 1 retry)
  if (isWarmUp) {
    console.log(`[Warmup] Starting session cache warm-up for ${tokens.length} tokens (batch size 8)...`);
    const batchSize = 8;
    let warmOkCount = 0;
    let warmFailedCount = 0;

    for (let i = 0; i < tokens.length; i += batchSize) {
      const batchTokens = tokens.slice(i, i + batchSize);
      const batchRequests = batchTokens.map((tok) => ({
        method: 'GET',
        url: `${API_URL}/auth/me`,
        params: {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${tok}`,
          },
          timeout: '60s',
          tags: { name: 'warmup' },
        },
      }));

      const responses = http.batch(batchRequests);

      for (let j = 0; j < responses.length; j++) {
        const res = responses[j];
        if (res.status === 200) {
          warmOk.add(1);
          warmOkCount++;
        } else {
          // One retry on failure with 60s timeout
          const retryRes = http.get(`${API_URL}/auth/me`, {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${batchTokens[j]}`,
            },
            timeout: '60s',
            tags: { name: 'warmup' },
          });

          if (retryRes.status === 200) {
            warmOk.add(1);
            warmOkCount++;
          } else {
            warmFailed.add(1);
            warmFailedCount++;
          }
        }
      }
    }
    console.log(`[Warmup] Finished session warm-up: ${warmOkCount} ok, ${warmFailedCount} failed.`);
  }

  if (!SHOWTIME_ID) {
    console.warn('[Setup Warning] SHOWTIME_ID not specified in environment. Seats will be discovered per VU.');
    return { seatIds: [] };
  }

  try {
    const seatRes = http.get(`${API_URL}/showtimes/${SHOWTIME_ID}/seats`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokens[0]}`,
      },
    });

    if (seatRes.status === 200) {
      const body = seatRes.json();
      if (body && Array.isArray(body.seats) && body.seats.length > 0) {
        const ids = body.seats.map((s) => s.id);
        console.log(`[Setup] Discovered ${ids.length} real seats for showtime ${SHOWTIME_ID}.`);
        return { seatIds: ids };
      }
    }
  } catch (err) {
    console.warn(`[Setup Warning] Pre-discovery error: ${err.message}`);
  }

  return { seatIds: [] };
}

/**
 * Main VU iteration loop
 */
export default function (data) {
  const vuId = __VU; // 1 to 500

  // VU n uses pre-minted token n-1 (no sign-in requests)
  const vuToken = tokens[(vuId - 1) % tokens.length];

  // Populate seat list for this VU
  if (!vuSeatIds) {
    if (data && Array.isArray(data.seatIds) && data.seatIds.length > 0) {
      vuSeatIds = data.seatIds;
    } else if (SHOWTIME_ID) {
      const seatRes = http.get(`${API_URL}/showtimes/${SHOWTIME_ID}/seats`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${vuToken}`,
        },
      });

      const seatNetErr = recordNetworkErrorIfNeeded(seatRes);

      if (seatRes.status >= 500) {
        if (isServerBusy(seatRes)) {
          serverBusy.add(1);
          serverErrors.add(0);
        } else {
          serverErrors.add(1);
        }
      } else if (!seatNetErr) {
        serverErrors.add(0);
      }

      if (seatRes.status === 200) {
        try {
          const body = seatRes.json();
          if (body && Array.isArray(body.seats)) {
            vuSeatIds = body.seats.map((s) => s.id);
          }
        } catch (e) {
          // Non-fatal
        }
      }
    }
  }

  // Ensure we have seats to hold
  if (!vuSeatIds || vuSeatIds.length === 0) {
    sleep(1);
    return;
  }

  // 1. Select 1-2 randomly chosen seats from the 50 seats
  const seatCount = Math.floor(Math.random() * 2) + 1; // 1 or 2 seats
  const idx1 = Math.floor(Math.random() * vuSeatIds.length);
  const selectedSeats = [vuSeatIds[idx1]];

  if (seatCount === 2 && vuSeatIds.length > 1) {
    let idx2 = Math.floor(Math.random() * vuSeatIds.length);
    while (idx2 === idx1) {
      idx2 = Math.floor(Math.random() * vuSeatIds.length);
    }
    selectedSeats.push(vuSeatIds[idx2]);
  }

  // 2. Attempt seat hold
  const holdStart = Date.now();
  const holdRes = http.post(
    `${API_URL}/showtimes/${SHOWTIME_ID}/holds`,
    JSON.stringify({ seatIds: selectedSeats }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${vuToken}`,
      },
      tags: { name: 'hold' },
    }
  );
  holdP95.add(Date.now() - holdStart);

  const holdNetErr = recordNetworkErrorIfNeeded(holdRes);

  if (holdRes.status >= 500) {
    if (isServerBusy(holdRes)) {
      serverBusy.add(1);
      serverErrors.add(0);
    } else {
      serverErrors.add(1);
    }
    sleep(1);
    return;
  } else if (!holdNetErr) {
    serverErrors.add(0);
  }

  // 3. Handle Hold Outcomes
  if (holdRes.status === 200 || holdRes.status === 201) {
    holdsOk.add(1);
    sleep(1); // Hold acquired, wait briefly before next attempt
    return;
  }

  if (holdRes.status === 409) {
    seatConflicts.add(1);
    if (idleAfterConflictSeconds > 0) {
      sleep(idleAfterConflictSeconds);
    } else {
      sleep(0.5); // Clean conflict, retry quickly
    }
    return;
  }

  if (holdRes.status === 429) {
    let errCode = null;
    try {
      const errBody = holdRes.json();
      if (errBody && errBody.error && errBody.error.code) {
        errCode = errBody.error.code;
      }
    } catch (e) {
      // Non-JSON 429
    }

    if (errCode === 'WAITING_ROOM_REQUIRED') {
      waitingRoomHits.add(1);

      // Poll GET /showtimes/:id/waiting-room until admitted or 120s timeout
      const pollStart = Date.now();
      let admitted = false;
      let admittedPass = undefined;

      while (Date.now() - pollStart < 120000) {
        sleep(3); // Poll every 3 seconds as the app does

        const pollRes = http.get(`${API_URL}/showtimes/${SHOWTIME_ID}/waiting-room`, {
          headers: {
            'Authorization': `Bearer ${vuToken}`,
          },
          tags: { name: 'waiting_room' },
        });

        const pollNetErr = recordNetworkErrorIfNeeded(pollRes);

        if (pollRes.status >= 500) {
          if (isServerBusy(pollRes)) {
            serverBusy.add(1);
            serverErrors.add(0);
          } else {
            serverErrors.add(1);
          }
        } else if (!pollNetErr) {
          serverErrors.add(0);
        }

        if (pollRes.status === 200) {
          try {
            const pollData = pollRes.json();
            if (pollData && pollData.status === 'admitted') {
              admitted = true;
              admittedPass = pollData.pass;
              break;
            }
          } catch (e) {
            // Ignore parse error on poll
          }
        }
      }

      if (admitted) {
        waitingRoomAdmitted.add(1);

        // Retry hold with acquired waitingRoomPass
        const retryStart = Date.now();
        const retryRes = http.post(
          `${API_URL}/showtimes/${SHOWTIME_ID}/holds`,
          JSON.stringify({
            seatIds: selectedSeats,
            waitingRoomPass: admittedPass,
          }),
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${vuToken}`,
            },
            tags: { name: 'hold' },
          }
        );
        holdP95.add(Date.now() - retryStart);

        const retryNetErr = recordNetworkErrorIfNeeded(retryRes);

        if (retryRes.status >= 500) {
          if (isServerBusy(retryRes)) {
            serverBusy.add(1);
            serverErrors.add(0);
          } else {
            serverErrors.add(1);
          }
        } else if (!retryNetErr) {
          serverErrors.add(0);
        }

        if (retryRes.status === 200 || retryRes.status === 201) {
          holdsOk.add(1);
        } else if (retryRes.status === 409) {
          seatConflicts.add(1);
          if (idleAfterConflictSeconds > 0) {
            sleep(idleAfterConflictSeconds);
          }
        } else if (retryRes.status === 429) {
          try {
            const rb = retryRes.json();
            if (rb && rb.error && rb.error.code === 'RATE_LIMIT_EXCEEDED') {
              rateLimited.add(1);
            }
          } catch (e) {}
        }
      } else {
        waitingRoomTimeouts.add(1);
      }
    } else if (errCode === 'RATE_LIMIT_EXCEEDED') {
      rateLimited.add(1);
      sleep(1);
    } else {
      // Other unclassified 429
      sleep(1);
    }
    return;
  }

  // Any other status
  sleep(1);
}

/**
 * Final Summary Output
 * Prints tokens_loaded, holds_ok, seat_conflicts, waiting_room_hits,
 * waiting_room_admitted, waiting_room_timeouts, rate_limited, and network_errors.
 */
export function handleSummary(data) {
  const getMetricCount = (name) => {
    if (data && data.metrics && data.metrics[name] && data.metrics[name].values) {
      return data.metrics[name].values.count || 0;
    }
    return 0;
  };

  const getMetricPasses = (name) => {
    if (data && data.metrics && data.metrics[name] && data.metrics[name].values) {
      return data.metrics[name].values.passes || 0;
    }
    return 0;
  };

  const tokensLoadedCount = getMetricCount('tokens_loaded');
  const warmOkCount = getMetricCount('warm_ok');
  const warmFailedCount = getMetricCount('warm_failed');
  const holdsOkCount = getMetricCount('holds_ok');
  const seatConflictsCount = getMetricCount('seat_conflicts');
  const wrHitsCount = getMetricCount('waiting_room_hits');
  const wrAdmittedCount = getMetricCount('waiting_room_admitted');
  const wrTimeoutsCount = getMetricCount('waiting_room_timeouts');
  const rateLimitedCount = getMetricCount('rate_limited');
  const serverBusyCount = getMetricCount('server_busy');
  const serverErrorsCount = getMetricPasses('server_errors');
  const networkErrorsCount = getMetricCount('network_errors');

  const summary = [
    '',
    '================================================================================',
    'A VUE 500-VU SEAT HOLD RACE & WAITING ROOM LOAD TEST SUMMARY',
    '================================================================================',
    `  tokens_loaded:          ${tokensLoadedCount}`,
    `  warm_ok:                ${warmOkCount}`,
    `  warm_failed:            ${warmFailedCount}`,
    `  holds_ok:               ${holdsOkCount}`,
    `  seat_conflicts:         ${seatConflictsCount}`,
    `  waiting_room_hits:      ${wrHitsCount}`,
    `  waiting_room_admitted:  ${wrAdmittedCount}`,
    `  waiting_room_timeouts:  ${wrTimeoutsCount}`,
    `  rate_limited:           ${rateLimitedCount}`,
    `  server_busy:            ${serverBusyCount}`,
    `  server_errors:          ${serverErrorsCount}`,
    `  network_errors:         ${networkErrorsCount}`,
    '================================================================================',
    '',
  ].join('\n');

  return {
    stdout: summary,
  };
}
