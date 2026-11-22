# ADR 0004: Waiting Room Concurrency Limit and Lazy Admission Rate

## Status
Accepted

## Context
High-profile movie premieres can draw thousands of simultaneous users to a single showtime within seconds. Without traffic smoothing, simultaneous seat-map queries and hold attempts cause resource contention.

## Decision
We implement a **serverless-compatible lazy waiting room** governed by two environment parameters:
1. **`WAITING_ROOM_ACTIVE_LIMIT` (Default: 100 concurrent active users)**:
   - Sets the ceiling for active viewers allowed to hold seats on a single showtime simultaneously.
   - Evaluated using an in-memory Redis active hash (`wr:{showtimeId}:active`) with 90-second sliding expiration.
2. **`WAITING_ROOM_ADMIT_PER_SEC` (Default: 5 users/second)**:
   - When active viewers exceed the limit, new users enter a Redis sorted set queue (`wr:{showtimeId}:queue`).
   - On each client poll, the server computes capacity and lazily admits queued users at a rate of 5 users per second, issuing an admission pass valid for 90 seconds.

## Consequences
- **Positive**: Eliminates database and cache lock contention during ticket release spikes. Flattens exponential traffic spikes into manageable constant-rate throughput.
- **Negative**: Users beyond the 100-user limit experience a short queue wait before holding seats.

