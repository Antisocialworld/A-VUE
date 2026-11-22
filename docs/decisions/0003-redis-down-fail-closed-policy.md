# ADR 0003: Redis Outage Fail-Closed Policy

## Status
Accepted

## Context
Redis serves as the high-throughput tier for seat holds, rate limits, and the waiting room queue. If the Redis cluster experiences network partitions, maintenance restarts, or connection exhaustion, the system must choose between two failure modes:
1. **Fail Open**: Bypass Redis and allow users to proceed directly to checkout, relying solely on database locking.
2. **Fail Closed**: Refuse new reservations and return a 503 Service Unavailable error until Redis connectivity is restored.

## Decision
A VUE enforces a **strict Fail-Closed policy for reservation writes**:
- **Seat Holds & Checkout**: If Redis is unreachable, `holdSeats` and `checkoutRateLimit` throw an error and return `503 SERVICE_UNAVAILABLE` with a safe retry hint. The system refuses to grant uncoordinated seat holds.
- **Seat Map Reads (Degraded Fallback)**: If Redis is offline during a seat map query (`getSeatMap`), the system falls back to querying confirmed bookings directly from Postgres, marking booked seats as `sold` and unbooked seats as `available`.

## Consequences
- **Positive**: Prevents uncoordinated stampedes on the Postgres database. Eliminates phantom holds and overselling during infrastructure disruptions.
- **Negative**: Temporary write unavailability during rare Redis outages.

