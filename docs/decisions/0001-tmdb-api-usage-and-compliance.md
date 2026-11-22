# ADR 0001: TMDB API Usage, Terms Compliance, and Backend Architecture

- **Status**: Decided / Accepted
- **Date**: 2026-11-13
- **Context**: A VUE cinema-ticket booking application (Phase 3 TMDB Integration)

---

## 1. Context & Scope

A VUE integrates with The Movie Database (TMDB) API to display currently scheduled films, synopsis details, and poster artwork. This decision record establishes legal, compliance, and architectural boundaries governing TMDB data consumption.

---

## 2. Decision & Invariants

### 2.1 Non-Commercial Assignment Boundary
- A VUE is developed strictly as a technical demonstration and bootcamp portfolio project.
- Payments run in test mode (Flutterwave sandbox); zero real revenue or monetary transactions are processed.
- **Commercial Terms Trigger**: Under TMDB API Terms of Use (Section 2), any transition to commercial deployment generating revenue requires a formal written commercial agreement with TMDB before launch.

### 2.2 Strict Cache Limits (Section 4 Compliance)
- TMDB API Terms permit local caching of API responses for up to 6 months.
- Our caching architecture enforces significantly tighter bounds:
  - **Now Playing List**: 10 minutes fresh (`tmdb:list:${page}`), 24 hours stale fallback (`tmdb:list:${page}:stale`).
  - **Movie Details**: 60 minutes fresh (`tmdb:movie:${id}`), 7 days maximum stale fallback (`tmdb:movie:${id}:stale`).
- Under no circumstances does any cached TMDB record exceed 7 days, comfortably inside TMDB's 6-month cap.

### 2.3 Mandatory Attribution & Logo (Section 3 Compliance)
- All public movie browsing surfaces (`MoviesHomeScreen` and `MovieDetailScreen`) prominently display the shared `TmdbAttribution` component.
- **Mandatory Disclaimer Text**:
  > "This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB."
- **Official Brand Asset**: The official TMDB logo (`app/assets/tmdb/tmdb-logo.png`) is displayed unmodified without recolouring, distortion, or cropping.
- **Visual Hierarchy**: The TMDB logo rendered height is set to 16 pt, ensuring it remains visibly smaller and secondary to the primary A VUE brand lockup and screen titles.

### 2.4 Backend-Only Access & Poster Proxying (Privacy Rule 02 & 08)
- The mobile app never communicates directly with TMDB servers or `image.tmdb.org`.
- TMDB secrets (`TMDB_API_TOKEN`) exist exclusively in the Fastify backend server environment.
- Poster images are proxied through `/movies/poster/:size/:file` with strict SSRF validation (whitelisted sizes `w185`, `w342`, `w500`, regex-validated filenames, 1 MB ceiling, and rate limiting).

---

## 3. Consequences

- Full compliance with TMDB API Terms of Use Sections 2, 3, and 4.
- Zero client credential leakage or user IP forwarding to third-party endpoints.
- High resilience under upstream outages via dual-tier Redis caching without exceeding data retention policies.

