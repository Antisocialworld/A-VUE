# ADR 0005: Polling vs. WebSockets / SSE for Seat Maps on Serverless

## Status
Accepted

## Context
Cinema seat selection requires real-time awareness of seat availability as other users reserve or purchase tickets. Three communication models were evaluated:
1. **WebSockets**: Full-duplex persistent bidirectional TCP connections.
2. **Server-Sent Events (SSE)**: Long-lived HTTP streaming from server to client.
3. **HTTP Short Polling**: Client queries every 3–5 seconds backed by an in-memory cache.

## Decision
We select **HTTP Short Polling backed by a 2-second Redis cache** (`SEAT_MAP_CACHE_SECONDS`):
1. **Serverless Infrastructure Fit**: A VUE API runs on Vercel Serverless. WebSockets and long-lived SSE connections are incompatible with stateless, ephemeral serverless function lifecycles and cause execution timeout issues.
2. **Cache Absorption**: Seat map responses are serialized and cached in Redis with a 2-second TTL. If 500 users poll the same showtime every 3–5 seconds, over 95% of requests hit the in-memory cache in sub-5ms, executing 0 database queries.
3. **Network Resilience**: Mobile devices moving between Wi-Fi and mobile data seamlessly resume polling without broken socket reconnect storms.

## Consequences
- **Positive**: Stateless, serverless-native, zero external socket broker costs, self-healing network resilience.
- **Negative**: Polling introduces up to 2–3 seconds of latency before another user's hold is reflected on a client screen.

