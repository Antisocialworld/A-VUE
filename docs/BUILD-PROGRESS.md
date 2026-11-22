# A VUE — Build Progress Log

## Current Status (12 Nov 2026)
Completed Auth Security Hardening, Accessibility Gate, UI Alignment, and Documentation:

### Verified by Owner (iPhone in Expo Go)
- **Sign-up flow**: Password checklist updates live per keystroke, masked dots visible, auto-focus active.
- **Code delivery**: Verification code email delivered cleanly to local Mailpit (port 1025).
- **Code verification & landing**: Verifies 6-digit code and transitions to Movies placeholder.
- **Movies screen**: Centered header, single-line "Sign out" action, empty state message.
- **Session lifecycle**: Sign out returns to Welcome; Sign in authenticates and returns to Movies.

### Unverified Items (Pending Named Phases)
- Native Android build (currently tested in Expo Go).
- Lua rate-limit script on Upstash over TCP: UNVERIFIED.
- Argon2 cost on Vercel cold start (dummy hash): UNVERIFIED.
- Real SMTP relay deliverability to Gmail without a verified domain: UNVERIFIED.
- Vercel trust proxy behaviour behind edge handler: UNVERIFIED.
- Flutterwave webhook signature scheme & payments: UNVERIFIED (Phase 6).

---

### Task Summary Breakdown

- **Task 1 (Server Mail Transport)**: Skipped, already done in previous round.
- **Task 2 (Shared Sign-Up Send Cap & Cooldown)**:
  - Implemented `consumeEmailSendSlot()` in `server/src/lib/sendCap.ts` keyed directly on email (independent of `auth_codes` table).
  - Both new and existing email branches in `POST /auth/signup` count against the same `DAILY_CODE_SEND_CAP` (5 sends/day) and `CODE_RESEND_COOLDOWN_SECONDS` (60s).
  - When capped or on cooldown, neither branch dispatches email, and both return identical 200 responses with `{ message: 'Verification code sent to email', email, cooldownSeconds: 60 }`.
- **Task 3 (Sign-Up Timing Hardening)**:
  - Added `await hashArgon2id(data.password)` to existing-email branch in `POST /auth/signup` matching the exact Argon2id cost parameters of the real path.
  - Keeps `await` mail dispatch behaviour identical.
  - Note: Does not claim full mitigation against microarchitectural timing differences (DB index lookup, Redis write differences, and network socket variations remain).
- **Task 4 (Proxy Setting Reconciliation)**:
  - Reconciled `TRUST_PROXY_HOPS` and `TRUST_PROXY` into ONE setting `TRUST_PROXY` in `env.ts`.
  - Defaults to `false` when missing or empty. Documented in `server/.env.example`.
- **Task 5 (Rate-Limit Proof & npm Scripts)**:
  - Added `server/scripts/smoke-ratelimit.ts` and npm script `"smoke:ratelimit"`.
  - Added `"typecheck": "tsc --noEmit"` to both `server/package.json` and `app/package.json`.
  - Reported that `"build"` script (`tsc`) already exists in `server/package.json`.
- **Task 6 (App Accessibility)**:
  - `Logo.tsx`: Never throws at render; warns in dev (`__DEV__`) only; test enforces label.
  - `CodeInput.tsx`: Dropped container label and set `accessible={false}` on container to allow TalkBack/VoiceOver to focus and announce individual digit cells.
  - `PasswordField.tsx`: Multiple checklist criteria changing in one keystroke trigger ONE combined announcement via `AccessibilityInfo.announceForAccessibility`.
  - `accessibility.test.ts`: Documented every scanner exemption with reason; all roles validated.
- **Task 7 (App UI Fixes)**:
  - `MoviesHomeScreen.tsx`: "Sign out" enforced on one line (`numberOfLines={1}`), minimum 44 px touch target, title stays centered via symmetric `ScreenShell` header slots.
  - `WelcomeScreen.tsx` & `App.tsx`: Component gallery link and route are restricted to `__DEV__`; never present in release builds.
  - `ScreenShell.tsx`: Replaced deprecated `SafeAreaView` from `'react-native'` with `react-native-safe-area-context`. Wrapped app in `<SafeAreaProvider>`.
- **Task 8 (App Env & Error Hygiene)**:
  - Verified `process.env.EXPO_PUBLIC_API_URL` is accessed exclusively as a literal.
  - Missing or non-HTTPS API URL in production throws generic `STRINGS.common.error`. Detailed messages are dev-only.
  - Network failures consistently present generic error string, never raw server text.
- **Task 9 (Docs Update)**:
  - Added 3 unverified items to `open-items.md`.
  - Updated `PRD.md` and `open-items.md` to reflect separate auth screens.
- **Task 10 (Mailer Test Tagline Assertion Resolution)**:
  - Investigated the historical email templates in `server/src/lib/mailer.ts`.
  - Confirmed the brand tagline "A view. Your view. Our view." was present in the HTML templates, but never existed in the plaintext `text` field for `sendVerificationCodeEmail` or `sendPasswordResetEmail` prior to the refactor.
  - Resolved by removing the erroneous `options.text` tagline assertion from both unit tests in `server/src/__tests__/mailer.test.ts`. Preserved 6-digit code, 5-minute expiry, and subject assertions intact.
- **Task 1 (Server Atomic Send Cap)**:
  - Replaced read-then-write in `server/src/lib/sendCap.ts` with one atomic Redis Lua script (`SEND_CAP_LUA`).
  - Parallel calls cannot exceed `DAILY_CODE_SEND_CAP` (5 sends/day) or bypass cooldown (60s).
  - Maintained identical response format `{ message: 'Verification code sent to email', email, cooldownSeconds: 60 }` for new and existing accounts and capped attempts.
  - Added comprehensive tests for parallel requests, daily cap boundaries, and cooldown windows in `server/src/__tests__/signupCapTiming.test.ts`.
- **Task 2 (Server No In-Memory Fallback)**:
  - Removed in-memory Map fallback entirely from `sendCap.ts`.
  - If Redis is unreachable, logs exactly one line to `process.stderr`: `[SendCap Error] <errorClass>\n` with zero user/email leakage.
  - Returns identical 200 response without throwing a 500 error; sends no email.
- **Task 3 (App Friendly Generic Error)**:
  - Added `genericError: 'Something went wrong. Please try again.'` to `STRINGS.common` in `app/src/constants/strings.ts`.
  - Used in `app/src/api/authClient.ts` for network failures, timeouts, production URL validation, and unmapped server errors.
  - Updated `app/src/__tests__/authClient.test.ts` to verify generic user-facing message.
- **Task 4 (App Button Label Scaling)**:
  - In `app/src/components/Button.tsx`, added `adjustsFontSizeToFit` and `minimumFontScale={0.75}` while preserving `numberOfLines={1}` and token styling to prevent accessibility text truncation.
- **Task 5 (Server Email Colours Mapping)**:
  - Mapped all 9 hex colors in `server/src/lib/mailer.ts` HTML templates to exact design tokens in `color-tokens-orange-green-yellow.json`.
  - Documented mappings in `mailer.ts` without altering existing hex values.
  - Documented compiler boundary constraint (`rootDir: "./src"`) preventing cross-package import.
- **Task 1 (App Missing Identifier Fix & Static Scanner)**:
  - Fixed startup crash `ReferenceError: Property 'EmptyState' doesn't exist` by importing `EmptyState` in `app/src/screens/ComponentGalleryScreen.tsx`.
  - Resolved missing `CodeInputRef` export by defining `export interface CodeInputRef` directly in `app/src/components/CodeInput.tsx`.
  - Added TypeScript AST static test `app/src/__tests__/staticJsxScanner.test.ts` scanning all `.tsx` files in `app/src` and `app/App.tsx` for any unimported/undeclared PascalCase JSX tags.
- **Task 2 (App Hidden Gallery in Every Build)**:
  - Removed visible "Component gallery" button from `WelcomeScreen.tsx` in all builds (no `__DEV__` gating).
  - Implemented hidden 2-second long-press gesture on the Welcome logo (`delayLongPress={2000}`) with `accessible={false}` and no visual hints, preserving the logo's `accessibilityRole="image"` and label.
  - Removed `isDev` gating on `'gallery'` route and navigation in `app/App.tsx`.
  - Added unit tests in `accessibility.test.ts` verifying no visible gallery strings on `WelcomeScreen` and asserting the gesture route is wired.
- **Task 1 (App tsconfig Resolution)**:
  - Removed `"moduleResolution": "node"` override from `app/tsconfig.json`, allowing the project to inherit `"moduleResolution": "bundler"` from `expo/tsconfig.base` and resolving TS5098 and TS5107.
- **Task 2 (App Accessibility Scanner Upgrade)**:
  - Added `accessibilityLabel={accessibilityLabel}` to the hidden `<TextInput>` in `app/src/components/CodeInput.tsx` from `STRINGS.verifyCode.codeLabel` (Case a).
  - Upgraded scanner in `app/src/__tests__/accessibility.test.ts` from fragile regex to TypeScript AST (`ts.createSourceFile`), properly distinguishing JSX elements from generic type parameters (`useRef<TextInput>`, `forwardRef<TextInput>`) and supporting spread props / variable labels (Case b).
- **Task 3 (App noInteractionManager AST Scanner)**:
  - Upgraded `app/src/__tests__/noInteractionManager.test.ts` to parse source via TypeScript AST, ignoring JSDoc/inline comments (such as in `useAutoFocus.ts`) and string literals while catching real imports, `require()`, and identifier calls.
- **Task 4 (App Fast Fake-Timer Timeout Test)**:
  - Added request timeout unit test in `app/src/__tests__/authClient.test.ts` leveraging `vi.useFakeTimers()` and `vi.advanceTimersByTime(10000)` to verify the 10s AbortController timeout immediately without wall-clock delay, asserting `STRINGS.common.genericError` and session preservation.
- **Task 1 (App Typecheck Errors & RN 0.88 Ref Types)**:
  - Fixed `accessibility.test.ts:148` by validating `ts.isIdentifier(prop.name)` before accessing `.text`.
  - Replaced `useRef<TextInput>` with `React.ComponentRef<typeof TextInput>` across `CodeInput.tsx`, `TextField.tsx`, `PasswordField.tsx`, and `ResetPasswordScreen.tsx`, matching React Native 0.88's `TextInputInstance` function component type without `any` or casts.
  - Updated `useAutoFocus.ts` with `FocusableTarget` and `CodeInputRef` without `any` or casts.
  - Removed unsupported `backgroundColor` prop on `StatusBar` in `ScreenShell.tsx`, relying on `SafeAreaView` edge-to-edge background tinting.
- **Task 2 (App Timeout Test & Suite Performance)**:
  - Switched `vi.advanceTimersByTime` to `await vi.advanceTimersByTimeAsync(10000)` in `authClient.test.ts`, allowing the asynchronous `await getSessionToken()` in `request()` to settle before advancing the 10s timeout timer.
  - Optimized `app/src/lib/secureStore.ts` to access `memoryFallbackToken` directly during tests without dynamic native `expo-secure-store` module import attempts, eliminating multi-second delays across tests.

- **Task 1 (Server sendCap Reason Type Fix)**:
  - Resolved `tsc` type error at `server/src/lib/sendCap.ts:89` where `reason` could be `'allowed'`.
  - Exported `type SendCapReason = 'allowed' | 'cooldown' | 'daily_cap' | 'redis_unreachable'` and typed `SendSlotResult.reason?: SendCapReason` without casts, `any`, or `ts-ignore`.
  - Safely typed parsing in `consumeEmailSendSlot()` so `reason` is omitted when `allowed: true`, and represents the cap or failure reason when `allowed: false`.
- **Task 2 (Server Redis-Unreachable Test & Rate Limiter 503 Separation)**:
  - Identified why `signupCapTiming.test.ts` received 503 instead of 200 when mocking Redis down: the auth IP rate limiter (`authRateLimit`) fails closed with 503 `SERVICE_UNAVAILABLE` at the Fastify preHandler level before route execution.
  - Updated Redis mock in `signupCapTiming.test.ts` to allow `rate_limit:auth:` keys through (`[1, 60]`) while throwing on send-cap keys (`email_cooldown:`).
  - Verified route returns 200, sends no mail, and logs single stderr line (`[SendCap Error] RedisConnectionError\n`) without recipient leak.
  - Added dedicated test verifying that when Redis is down for the auth IP rate limiter, requests fail closed with generic 503 (`SERVICE_UNAVAILABLE`).
- **Task 3 (App AuthClient Timeout Unhandled Rejection Fix)**:
  - Fixed unhandled promise rejection in `app/src/__tests__/authClient.test.ts` for the 10s fake-timer timeout test.
  - Attached `const expectationPromise = expect(requestPromise).rejects.toThrow(...)` before `await vi.advanceTimersByTimeAsync(10000)`, awaiting `expectationPromise` after timers advance.

- **Task 1 (Welcome Screen Redesign & Character Illustration Audit)**:
  - Audited `c:\Users\SETUP\Desktop\A VUE\a-vue-final` and `app/assets/` for the character illustration (orange projector head, lime lens, green top, lifting clapper arm).
  - Identified that the character illustration only exists embedded inside the larger 5.5s animated HTML document (`a-vue-final/motion/a-vue-motion-long-5.5s.html`), and is not available as a separate SVG asset.
  - Per the explicit task instruction ("If it only exists inside a larger file, do NOT redraw or approximate it: report this and stop Task 1"), stopped Task 1 without modifying `WelcomeScreen.tsx` or approximating the art.
  - Audited contrast ratios: Sign up outline/label (`primary 80`: `#FFCEBE`) against light surface (`#FFF4F1`) is 1.31:1 (contrast failure, reported), and against dark surface (`#1A110F`) is 13.12:1 (passes).
  - Listed screens using the brand name asset: `WelcomeScreen.tsx` and `ComponentGalleryScreen.tsx` (both via `<Logo />`).
- **Task 2 (Sign Out Colour on MoviesHomeScreen & Contrast Audit)**:
  - Added optional `textColor?: string` prop to `Button` (`app/src/components/Button.tsx`), supporting custom tokenized text colors while maintaining accessibility states and loading indicators.
  - Updated `MoviesHomeScreen.tsx` to style the "Sign out" text button using `colors.error` from the design tokens (`LightColors.error` = `#BA1A1A`, `DarkColors.error` = `#FFB4AB`).
  - Verified WCAG AA contrast ratio $\ge 4.5:1$ against surface background: Light mode `#BA1A1A` on `#FFF4F1` yields 5.97:1; Dark mode `#FFB4AB` on `#1A110F` yields 10.96:1.
  - Added automated test in `app/src/__tests__/tokens.test.ts` calculating and asserting the exact relative luminance and $\ge 4.5:1$ contrast ratios in both modes.

- **Task 0 (Tokens Test Assertion Fix)**:
  - Removed exact-value pinning assertions (`5.97` light, `10.96` dark) from `app/src/__tests__/tokens.test.ts`.
  - Retained strict WCAG AA $\ge 4.5$ checks for light and dark modes against surface backgrounds.
- **Task 1 (Art Extraction & react-native-svg Dependency Check)**:
  - Extracted `app/assets/art/a-vue-character.svg` from `a-vue-final/motion/a-vue-motion-long-5.5s.html`, frozen at animation time $t = 45\%$ (2.475 s) where the character stands at the clapper with arm raised lifting the clapper arm open at -24°.
  - Extracted `app/assets/art/a-vue-wordmark.svg` containing the "A VUE" stroked letter paths without hardcoded color.
  - Checked `app/package.json` and verified `react-native-svg` is missing. Per Task 1c, stopped before Step 2 (Task 2 & 3) and provided `npx expo install react-native-svg` command for the owner.
- **Task 4 (Sign Out Dark-Mode Tone 60 Red & Error Palette Audit)**:
  - Audited all 14 tones in the design system error palette against light surface (`#FFF4F1`) and dark surface (`#1A110F`).
  - Identified that tone 60 (`#FF5449`) provides a true-red appearance on dark surface with 5.85:1 contrast ($\ge 4.5:1$).
  - Updated `MoviesHomeScreen.tsx` to use `colorData.palettes.error['60']` in dark mode while keeping `colors.error` in light mode, without altering any theme files.

- **Task 2 (Unified ClapperMark & CharacterArt Components)**:
  - Created `ClapperMark` (`app/src/components/ClapperMark.tsx`) rendering the clapperboard with raised lid, dark panel, and centered "A VUE" wordmark using `react-native-svg` primitives and token values (`palette primary 40` for board, `palette neutral 6` for dark panel, `palette primary 80` for wordmark, `brand crest yellow` for lid stripes).
  - Created `CharacterArt` (`app/src/components/CharacterArt.tsx`) rendering the character illustration frozen in pose lifting the clapper lid ($t = 45\%$), with `accessible={false}` and `aria-hidden={true}` (decorative).
  - Created `Wordmark` (`app/src/components/Wordmark.tsx`) housing the single shared source of letterform paths (`WORDMARK_PATHS`), shared by `ClapperMark` and `WordmarkName`.
- **Task 3 (Welcome Screen Redesign - Option 2b)**:
  - Redesigned `app/src/screens/WelcomeScreen.tsx` top-to-bottom: ClapperMark with CharacterArt at its right lifting the lid, Sign in button (solid primary 40), and Sign up button (outlined 3px border, transparent fill).
  - Extended `Button` (`app/src/components/Button.tsx`) to support `variant="outlined"` with 3px border: dark theme uses `palette primary 80` for border & label; light theme uses `palette primary 30` for border (computed 5.08:1 $\ge$ 3:1 on light surface) and `colors.on_surface` for label.
  - Removed tagline from Welcome screen; preserved hidden 2-second long-press gesture on hero artwork for component gallery.
- **Task 4 (Logo Consistency & Old Logo Audit)**:
  - Replaced old lockup in `Logo.tsx` with `ClapperMark`, ensuring all callers (including `ComponentGalleryScreen.tsx`) render the new unified logo while keeping `LogoProps` backward-compatible.
  - Added outlined button states to `ComponentGalleryScreen.tsx`.
- **Task 5b (Design Contrast Audit Test)**:
  - Added `app/src/__tests__/designContrast.test.ts` computing in code the relative luminance and contrast ratios for name on panel ($\ge 4.5:1$), Sign up border ($\ge 3:1$) and label ($\ge 4.5:1$) in both themes, and Sign out color ($\ge 4.5:1$) in both themes, asserting only the standard minimum thresholds.
- **Task 6 (Welcome Screen Hero Alignment, Geometry, Restored Tagline, & Layout Test)**:
  - Created `WelcomeHero` (`app/src/components/WelcomeHero.tsx`) unifying `ClapperMark` and `CharacterArt` into ONE `react-native-svg` composition sharing ONE `viewBox` (`"120 48 172 152"`).
  - Extracted pure function `getHeroGeometry()` (`app/src/constants/heroGeometry.ts`):
    - Ground line $y = 190$: clapperboard bottom ($y = 132 + 58 = 190$) and character feet sit on the exact same ground line.
    - Zero clipping: all drawn artwork (reaching arm, hand, raised lid, projector head, shadow, feet) fits inside visible bounding box $X \in [126, 286]$ (width 160 px), $Y \in [54, 195]$ (height 141 px).
    - Horizontal centre: bounding box centre ($X = 206$) matches viewBox centre ($X = 206$), yielding `centreOffset: 0`.
  - Updated `WelcomeScreen.tsx`:
    - Upper group containing `WelcomeHero` (with 2s hidden gallery long-press gesture, `accessibilityRole="image"`, labeled "A VUE"), gap (`spacing.lg`), tagline, gap (`spacing.sm`), and decorative rule.
    - Restored tagline (`STRINGS.welcome.subtitle`) directly below hero, centered, using button label typography (`typography.labelLarge`). Colors: dark mode uses `palette primary 80` (`#FFCEBE`), light mode uses `colors.on_surface` (`#231917`). Wraps centered on narrow screens without font shrinking.
    - Added decorative rule: 2 px high, centered, width 40% of measured tagline width (`onLayout`), same color token as tagline, hidden from screen readers (`accessible={false}`, `aria-hidden={true}`).
    - Vertical rhythm uses spacing tokens only (`spacing.xxl`, `spacing.lg`, `spacing.sm`, `spacing.md`), free space in middle, action buttons pinned to bottom with safe-area handling, equal widths, and flush edges.
  - Added unit test `app/src/__tests__/heroLayout.test.ts` asserting:
    - `boardBottomY === feetY === 190`
    - All bounding box edges strictly within `viewBox` with positive padding (zero clipping)
    - `centreOffset === 0`
    - Exact viewBox (`120 48 172 152`) and bounding box dimensions ($160 \times 141$).
- **Task 7 (Welcome Screen Centring Fix & Dev Gear Floating Shortcut)**:
  - Vertical Centring: Restructured `WelcomeScreen.tsx` so the upper group (hero + tagline + rule) is enclosed in `freeArea` (`flex: 1`, `justifyContent: 'center'`) between the top safe area and the top edge of the Sign in button, guaranteeing space above equals space below without hard-coded pixel offsets.
  - Horizontal Centring: Recomputed true drawn bounding box accounting for the raised lid's rotation (top-left reaches $X = 119.5$) to the ground shadow right edge ($X = 286.0$), setting bounding box center to $X = 202.75$. Symmetrically centered viewBox ($X = 112.75$, width $180$, center $202.75$), achieving exact `centreOffset: 0` from the drawn bounding box.
  - Dev Gear Button: Added circular floating blue gear button (`testID="dev-gallery-gear-button"`) in the top-right corner below the status bar (`top: spacing.md`, `right: spacing.base`), styled with `colorData.chart.light[3]` (`#0B4EB9`). Gated strictly by `__DEV__` (`{__DEV__ && Boolean(onNavigateToGallery)}`) so it appears only in development builds and never in production, avoiding overlap with any Welcome controls while preserving the 2s hidden gesture.
  - Layout Test Extensions: Added `computeVerticalCentering()` pure function and unit tests asserting space above equals space below ($\text{difference} \le 1$) across varied mobile screen heights and safe-area insets. Updated geometry test to assert drawn bounding box $X \in [119.5, 286.0]$, viewBox `"112.75 48 180 152"`, and `centreOffset: 0`.
- **Task 8 (Welcome Screen Vertical Offset Source, Long-Press Fix, & Dev Gear Preservation)**:
  - Vertical Offset Investigation: Identified source of the 13 pt vertical shift — `ScreenShell.tsx` line 130 sets `padding: spacing.base` (16 pt = 48 px at 3x) on `ContentWrapper`. Because `freeArea` sat inside `ContentWrapper` with this top padding, its top boundary was 16 pt below the top safe-area edge.
  - Vertical Centring Fix: Added `paddingTop: 0` to `styles.shellContent` in `WelcomeScreen.tsx` (without modifying `ScreenShell.tsx`), overriding the 16 pt default and allowing `freeArea` to begin directly at the top safe-area boundary. Flexbox `justifyContent: 'center'` now divides remaining space equally: space above the group equals space below it within 1 pt ($\text{difference} = 0$).
  - Long-Press Failure Investigation & Fix: Identified that `react-native-svg`'s native `SvgView` intercepts touch events by default, cancelling the 2000 ms long-press responder timer in the wrapping `Pressable`. Fixed by adding `pointerEvents="none"` to `WelcomeHero`'s wrapping `<View>` and `<Svg>` (defaulting in `WelcomeHeroProps`), and adding `hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}` to `Pressable`. Confirmed long-press is active across all builds (not gated to `__DEV__`).
  - Dev Gear Button Preserved: Retained the floating blue gear button (`testID="dev-gallery-gear-button"`) in the top-right corner below the status bar, gated strictly by `__DEV__`, per owner's explicit instruction.
  - Layout & Static Tests: Updated `computeVerticalCentering()` in `heroGeometry.ts` to model `reservedTopSpace` (showing 16 pt disparity when present vs 0 pt difference when eliminated) and added static AST test in `heroLayout.test.ts` verifying that `WelcomeScreen` wraps `WelcomeHero` in a `Pressable` with `delayLongPress={2000}`.
- **Task 9 (Welcome Screen Long-Press Touch Architecture & 5 pt Residual Visible Centring)**:
  - Route Trace: Traced `onNavigateToGallery` from `App.tsx` through `MainNavigator` to `currentRoute = 'gallery'` and `<ComponentGalleryScreen>`, confirming both long-press and gear button invoke the exact same state transition.
  - Sibling Touch Overlay Architecture: Replaced parent-wrapper pressable pattern with a relative container (`heroContainer`) containing `WelcomeHero` (`pointerEvents="none"`) and a sibling transparent `Pressable` (`heroOverlayPressable`, `position: 'absolute'`, `zIndex: 10`, `accessible={false}`) with `delayLongPress={2000}` and `hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}`, eliminating any potential gesture responder interception by child views on iOS.
  - Covering Elements Audit: Checked all elements in `WelcomeScreen` and `ScreenShell`. Confirmed no covering overlays exist; `devGearButton` is confined to top-right corner.
  - Residual 5 pt Vertical Centring: Analyzed invisible whitespace sources: viewBox top invisible padding is 8.0 pt ($6\text{ units} \times 4/3$ above projector head), while bottom rule padding is 0.0 pt. With font leading, visible asymmetry is 10.0 pt (30 px at 3x, yielding the 5 pt / 15 px downward shift). Derived compensation via `getVisualCenteringCompensation(240)` ($5.0\text{ pt}$) and applied `transform: [{ translateY: -visualCompensation }]` to `heroGroup`.
  - Pure-Function & Static Tests: Updated `computeVerticalCentering()` to compute visible gaps above and below, asserting equal visible gaps within 1 pt. Added static AST test verifying overlay Pressable is a direct sibling of `WelcomeHero` inside `heroContainer` with matching handler.
- **Phase 3 (TMDB Integration, Movies Home, Detail & EmptyState Watermark — Tasks 1 to 6)**:
  - **Server TMDB Client (Task 1)**: Added `TMDB_API_TOKEN` validation to `server/src/env.ts` (optional at startup; clean 503 generic message if missing). Built `server/src/lib/tmdb.ts` with 5s timeout, one retry on 5xx/timeout with crypto-based jittered backoff (`crypto.randomBytes`, `Math.random` strictly banned), Zod-parsed TMDB responses, clean DTO mapping (`id`, `title`, `overview`, `releaseDate`, `runtimeMinutes`, `genres`, `voteAverage`, `posterPath`, `backdropPath`), Redis caching (`tmdb:list:${page}` 600s, `tmdb:movie:${id}` 3600s), and graceful fallback to direct TMDB fetch when Redis is unavailable.
  - **Server Routes & Shared Contracts (Task 2)**: Added `GET /movies` (paginated 1..5) and `GET /movies/:id` gated by `getSessionUser`. Built SSRF-guarded image proxy `GET /movies/poster/:size/:file` (`size` $\in$ `['w185', 'w342', 'w500']`, regex `^[A-Za-z0-9_-]{5,64}\.jpg$`, fixed host `image.tmdb.org`, max 1 MB, `Cache-Control: public, max-age=86400`, `Content-Type: image/jpeg`). Added `posterRateLimit` (120 req/min/IP). Added shared contract fixtures in `contracts/movie-cases.json` and mirrored Zod schemas in `server/src/schemas/movies.ts` and `app/src/schemas/movies.ts`. Added server test suite `server/src/__tests__/movies.test.ts`.
  - **App API Client & Movies Home List (Task 3)**: Created `app/src/api/moviesClient.ts` routing poster URLs through backend proxy. Created `Skeleton.tsx` token-based placeholder block and `MovieCard.tsx` 2-column card with poster image, fallback token block, title, release year, rating, `accessibilityRole="button"`, formatted label `"<title>, <year>, rated <x> out of 10"`, and $\ge 44$ pt touch targets. Updated `MoviesHomeScreen.tsx` with 2-column grid, pull-to-refresh, "Load more" button pagination (no infinite scroll), loading skeleton, error retry, empty watermark state, and TMDB attribution string.
  - **Movie Detail Screen (Task 4)**: Created `MovieDetailScreen.tsx` with backdrop/poster, title, release year, runtime, genres, rating, overview, loading skeleton, error retry, back control ($\ge 44$ pt touch target), and TMDB attribution string. Wired route `'movie_detail'` and `selectedMovieId` state in `App.tsx`.
  - **EmptyState Watermark (Task 5)**: Extended `EmptyState.tsx` with optional `showWatermark` prop rendering `ClapperMark` watermark centered behind title and message (~55% card width, opacity 0.10 dark / 0.08 light, decorative `accessible={false}`, `aria-hidden`, `pointerEvents="none"`, contrast $\ge 4.5:1$). Guaranteed action button sits strictly below watermark wrapper with $\ge \text{spacing.base}$ margin. Added watermark entry in `ComponentGalleryScreen.tsx` and unit tests in `emptyStateWatermark.test.ts`.
  - **Known Gaps (Reported under "Not Done")**: No showtimes or cinemas tables/endpoints exist yet in DB schema (Phase 1/3 scope boundary; not wired); TMDB API requires owner to supply `TMDB_API_TOKEN` in `server/.env` for live upstream data; seat booking and checkout sheet remain to be built in subsequent phases.
- **Phase 3 Additions (Tasks A to D)**:
  - **Task A (One File Knows TMDB)**: Isolated TMDB response schemas, client methods, and DTO mappings strictly inside `server/src/lib/tmdb.ts`. Verified via automated AST scanner test in `server/src/__tests__/movies.test.ts` that no TMDB response field names (`poster_path`, `release_date`, `vote_average`, `now_playing`) exist in any other server source file.
  - **Task B (TMDB Failure Handling, Stale Fallback, 429 & Single-Flight)**: Implemented dual-tier Redis caching storing a stale copy beside each fresh entry (list fresh 10 min, stale 24 h; detail fresh 60 min, stale 7 days). On upstream failure, server returns stale copy with `stale: true` flag in the payload; if no stale copy exists, returns generic 503 for app retry. Implemented upstream `429 Too Many Requests` handling honoring `Retry-After` capped at 5s (falling back to stale cache if cap is exceeded). Implemented in-flight request deduplication (`singleFlight`) guaranteeing concurrent identical requests trigger exactly one upstream call. Documented all TTL decisions in `docs/ARCHITECTURE.md`.
  - **Task C (Progressive Posters & List Performance)**: Enhanced `MovieCard.tsx` with progressive image loading: shows `Skeleton` placeholder while image loads, smoothly fades in using React Native built-in `Animated.Image` (`Animated.timing`, duration 250ms), and relies on device HTTP caching engine (`Cache-Control: public, max-age=86400`). Memoised card with `React.memo` and eliminated inline arrow closures in `MoviesHomeScreen.tsx` via `useCallback` for `keyExtractor` and `renderItem`. Verified zero reanimated transitions or haptics used.
  - **Task D (TMDB Attribution & ADR 0001)**: Updated mandatory attribution notice in `STRINGS.movies.tmdbAttribution` to exact text: `"This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB."`. Built shared `TmdbAttribution` component integrating the official TMDB logo (`app/assets/tmdb/tmdb-logo.png`) rendered at 16 pt height (aspect ratio ~7.7:1, un-recoloured, un-cropped) placed above notice text, visibly smaller and less prominent than the A VUE title/logo. Replaced text-only attributions in `MoviesHomeScreen` and `MovieDetailScreen`. Documented TMDB compliance, 6-month vs 7-day cache rules, and non-commercial scope in `docs/decisions/0001-tmdb-api-usage-and-compliance.md`.
- **Security Rule Specification (Flutterwave v3 verif-hash)**: Verified official Flutterwave v3 documentation: webhooks pass a plain secret hash in the `verif-hash` header rather than HMAC-SHA256. Verification is performed via constant-time comparison (`crypto.timingSafeEqual`) on `verif-hash` against `FLUTTERWAVE_SECRET_HASH` with an exact buffer length check. Reverted Rule 05 back to strict SHA-256 restriction (QR reference only). Updated `.agents/rules/01-agent-rules.md`, `.agents/rules/02-security.md`, `.agents/rules/04-traffic-payments.md`, and `open-items.md` (Q9 settled).
- **Phases 4, 5, 6 & Core Documentation (Tasks 1 to 11)**:
  - **Task 1 (Real SMTP Relay)**: Enforced production relay requirements in `server/src/env.ts` (requires `SMTP_USER`, `SMTP_PASS`, and non-localhost host). Strictly forbid Gmail/Googlemail SMTP in any environment (Rule 02). Added unit tests in `mailer.test.ts`.
  - **Task 2 (Data Model & Seed Script)**: Created forward-only migration `server/migrations/002_cinema_showtimes_payments.sql` adding `cancelled_at` to showtimes, `accessible` boolean and `row`/`number` to seats, user-scoped payment idempotency (`uq_payments_user_idempotency`), dedicated `idempotency_keys` table (24h expiry), `refunds` table, `tickets` table with SHA-256 `qr_hash`, and immutable append-only `ledger` with database trigger `trg_ledger_immutable`. Created seed script `server/scripts/seed.ts` seeding 2 cinemas, 360-seat hall with 40 wheelchair-accessible seats, and 7-day showtimes for supplied movie IDs. Added migration unit tests in `migrations.test.ts`.
  - **Task 3 (Showtimes & Seat Map Read API)**: Implemented `GET /movies/:id/showtimes` and `GET /showtimes/:id/seats` with 2s Redis caching (`SEAT_MAP_CACHE_SECONDS`), dynamic status blending (DB sold + Redis sold markers + Redis holds), and dual-tier rate limiting.
  - **Task 4 (Atomic Seat Holds & Rate Limits)**: Built `server/src/lib/holds.ts` with atomic multi-seat hold Lua script (`HOLD_SEATS_LUA`), owner-only compare-and-delete release (`RELEASE_SEATS_LUA`), permanent sold marker (`markSeatsSold`), and fail-closed Redis resilience (503). Added `holdRateLimit` (10/min/user, 120/min/IP) and `checkoutRateLimit` (5/min/user, 20/min/IP). Added unit tests in `holds.test.ts`.
  - **Task 5 (Waiting Room Queue)**: Implemented serverless lazy waiting room queue in `server/src/lib/waitingRoom.ts` (`WAITING_ROOM_ACTIVE_LIMIT` default 100, `WAITING_ROOM_ADMIT_PER_SEC` default 5). Returns queue position or 90s admission pass. Gated `POST /showtimes/:id/holds` when active.
  - **Task 6 (Checkout & Flutterwave Initiation)**: Implemented `POST /checkout` with mandatory `Idempotency-Key` header, user hold verification, server-computed price and service fee (`SERVICE_FEE_BPS` default 500 = 5%), pending payment recording, and Flutterwave hosted checkout link creation. Refused `PAYMENT_SIMULATOR` in production. Added unit tests in `checkout.test.ts`.
  - **Task 7 (Webhook, Confirmation & Late Webhook Auto-Refund)**: Implemented `POST /webhooks/flutterwave` with constant-time signature verification (`verifyFlutterwaveSignature`), event deduplication, fast 200 response, and background booking confirmation. Handled late-webhook race condition catching unique constraint violation on `bookings`, auto-refunding to `refunds` table and `ledger`. Added secured `POST /cron/jobs` with `CRON_SECRET`.
  - **Task 8 (Tickets with SHA-256 QR Reference)**: Implemented `GET /tickets` and `GET /tickets/verify/:reference`. Opaque random 256-bit reference generated from `crypto.randomBytes`; database stores strictly its SHA-256 hash. Gatekeeper endpoint verifies tickets without exposing user secrets in QR.
  - **Task 9 (Refunds & Immutable Ledger)**: Implemented `cancelShowtimeAndRefund` in `server/src/lib/jobs.ts` and `POST /showtimes/:id/cancel`. Idempotent refund execution updating `refunds`, `bookings`, `payments`, and appending `refund_out` entries to immutable `ledger`.
  - **Task 10 (Load-Test Script)**: Created k6 load-test script `load-tests/seat-contention.js` simulating 500 virtual users competing for 50 seats simultaneously with custom metrics for response time, conflict rate, and zero double bookings.
  - **Task 11 (Documentation & ADRs)**: Authored `TRAFFIC.md`, `SHARDING.md`, `README.md`, `LEARNING-LOG.md`, updated `docs/ARCHITECTURE.md` (connection pooling and read-your-own-writes Redis pin), and created ADRs 0002 (late webhook race), 0003 (Redis fail closed), 0004 (waiting room numbers), and 0005 (polling vs WebSockets/SSE).

- **Phase 6 Server Fix Pass, Webhook & App Card Equal Height (Tasks 1 to 7)**:
  - **Task 1 (Typecheck Fixes)**: Resolved all 13 TypeScript errors in `/server`. Replaced non-existent `getPool()` import with real database accessor `writerPool` across `holds.ts`, `jobs.ts`, `checkout.ts`, `showtimes.ts`, `tickets.ts`, `webhooks.ts`, and `seed.ts`. Corrected `getSessionUser(request)` signature (takes 1 parameter) and wrapped in try/catch across all protected endpoints returning standard 401 `UNAUTHORIZED` envelopes.
  - **Task 2 (Test Suite Fixes)**: Resolved `REDIS_UNAVAILABLE` in `holds.test.ts` by scoping unit tests to pure logic (empty seats, max limit) and creating `server/src/__tests__/holds.integration.test.ts` for live Docker Redis tests. Configured `vitest.config.ts` to exclude integration tests from default `npm test` and added `"test:integration"` script to `package.json`. Resolved `webhooksTickets.test.ts` verification failures by accessing `env.FLUTTERWAVE_SECRET_HASH || process.env.FLUTTERWAVE_SECRET_HASH`.
  - **Task 3 (Webhook Verification & Re-query)**: Confirmed official Flutterwave v3 documentation: webhooks pass a plain secret hash in the `verif-hash` header rather than HMAC-SHA256. Completely removed HMAC branch. Verification performs constant-time compare (`crypto.timingSafeEqual`) against `FLUTTERWAVE_SECRET_HASH` with an exact buffer length check. Reverted Rule 05 back to strict SHA-256 restriction (QR only). Implemented Flutterwave transaction verification re-query (`verifyTransactionWithFlutterwave`) in `jobs.ts` validating successful status, exact integer kobo amount (`nairaToKobo`), currency matching `NGN`, and `tx_ref`. Flagged payments on mismatch; skipped re-query only under `PAYMENT_SIMULATOR`.
  - **Task 4 (Tickets Security & Verification)**: Removed `qrReference` from `GET /tickets` response (database stores strictly SHA-256 `qr_hash`). Added owner-only `POST /tickets/:id/qr` generating fresh 256-bit crypto random references, atomically updating `qr_hash`, and returning the reference once. Changed verification to `POST /tickets/verify` accepting reference in JSON body (never in URLs or logs). Atomically marks ticket `'used'` and records `used_at = NOW()` via `UPDATE ... RETURNING` in forward-only migration `003_tickets_used_at.sql`, returning `already_used` on repeat scans.
  - **Task 5 (Admin Authorization)**: Added `ADMIN_EMAILS` (comma-separated string, case-insensitive) to `server/src/env.ts` with `isAdmin(email)` helper. Guarded `POST /showtimes/:id/cancel` and `POST /tickets/verify` with 403 `FORBIDDEN` error envelope for non-admin callers.
  - **Task 6 (Load Test Realism & Session Tokens)**: Created `server/scripts/loadtest-sessions.ts` (`npm run seed:loadtest-sessions`) provisioning 500 test users (`@example.invalid`) with Argon2id passwords and real authenticated session tokens written to git-ignored `.loadtest-tokens.json` and `load-tests/tokens.json`. Strictly refuses execution in production. Wired `load-tests/seat-contention.js` to read tokens and distribute to VUs. Added token files to `.gitignore`.
  - **Task 7 (App MovieCard Equal Height Layout)**: Fixed row height mismatch in Movies home grid by adding `minHeight: typography.titleSmall.lineHeight * 2` to `MovieCard` title style, reserving exactly 2 lines of text height using existing typography tokens. Set `cardContainer` to `flex: 1` and `infoContainer` to `flex: 1, justifyContent: 'space-between'` so all cards in a row have identical height and metadata lines up flush. Added unit test in `app/src/__tests__/moviesContract.test.ts`.

- **Phase 6 Server Fix Pass 2 (Tasks 1 to 6)**:
  - **Task 1 (Webhook Empty-Secret Bypass & Production Validation)**: Updated `verifyFlutterwaveSignature` in `server/src/lib/flutterwave.ts` so an empty header and empty secret never compare equal. Returns `false` when `FLUTTERWAVE_SECRET_HASH` is empty, unset, or whitespace-only, and when `verif-hash` is missing, empty, or whitespace-only. Added production env refinement in `server/src/env.ts` requiring non-empty `FLUTTERWAVE_SECRET_HASH` and `FLUTTERWAVE_SECRET_KEY` when `NODE_ENV === 'production'`.
  - **Task 2 (Transaction Mismatch Handling & Migration 004)**: Created forward-only migration `server/migrations/004_payments_flagged_status.sql` extending `payments_status_check` to allow `'flagged'`. Created pure validator `checkTransactionMismatch` in `server/src/lib/jobs.ts` inspecting status, integer kobo amount, currency (`NGN`), and `txRef`. On mismatch, marks payment `flagged` (never `failed`), creates no booking, confirms no seats, lets Redis hold expire naturally, inserts NO forbidden ledger rows, logs only payment ID and reason (no secrets or PII), and returns 200.
  - **Task 3 (Ticket Status Literals Audit)**: Verified that database `tickets.status` values used in code (`'active'`, `'used'`, `'cancelled'`) exactly match the CHECK constraint in migration 002. Added automated test verifying `tickets.ts` and `cinema.ts` status literals against migration 002 SQL.
  - **Task 4 (Auth 401 Error Boundary & DB Error Rethrow)**: Exported `UnauthorizedError` from `server/src/lib/session.ts` and updated `getSessionUser` to throw `UnauthorizedError` on auth/session failures. Updated `try/catch` in `showtimes.ts`, `checkout.ts`, and `tickets.ts` to catch ONLY `UnauthorizedError` and return 401, while rethrowing all other errors (such as database query failures) to Fastify's normal 500 handler.
  - **Task 5 (Test-Driven Production Code)**: Removed all `process.env` fallbacks from `server/src/lib/flutterwave.ts` so production code reads only validated `env`. Updated tests in `server/src/__tests__/webhooksTickets.test.ts` to use `vi.stubEnv` and dynamic module imports.
  - **Task 6 (Migration Runner Audit)**: Confirmed that `server/package.json` defines `"migrate": "tsx src/db/migrate.ts"`. Confirmed tracking via `migrations_ledger` table and that running `npm run migrate` applies 002, 003, and 004 sequentially within individual transactions.

- **Phase 7 App Booking Screens & Cinema Integration (Tasks 1 to 8)**:
  - **Task 1 (Movie Detail Sticky "Get tickets")**: Added sticky bottom action bar with "Get tickets" button in `MovieDetailScreen.tsx` connecting to Showtimes. Set `scrollable={false}` on `ScreenShell` with inner `ScrollView` so the action bar remains anchored above the bottom safe area.
  - **Task 2 (Showtimes Screen)**: Built `ShowtimesScreen.tsx` with movie mini header, dynamic 7-day date strip, and cinemas grouped with interactive time tiles. Displays formatted price, availability badges, disabled state on sold out/cancelled, and skeleton/empty/error states.
  - **Task 3 (SeatMap Component & States)**: Built `SeatMap.tsx` rendering 360-seat hall geometry from `GET /showtimes/:id/seats`. Distinguishes states (available, selected, held, sold, wheelchair accessible) by SHAPE and COLOUR for accessibility compliance. Enforces 6-seat server limit (`MAX_SEATS_PER_BOOKING`). Polls every 4s while focused/foregrounded, auto-deselecting newly unavailable seats with a `Toast`. Implemented fit-to-zoom toggle, touch targets $\ge 44$ pt, and horizontal scrollable rows for screen readers (`AccessibilityInfo`). Added haptic feedback on selection, added to `ComponentGalleryScreen.tsx`, and documented in `COMPONENTS.md`.
  - **Task 4 (Holds & Waiting Room)**: Handled `POST /showtimes/:id/holds` responses. On 429 `WAITING_ROOM_REQUIRED`, opens `WaitingRoomScreen.tsx`, polls queue status every 3s, and automatically retries hold upon admission with pass token. On 409, triggers `Toast` alert and refreshes seat map. On 503, presents retry alert.
  - **Task 5 (Checkout Screen)**: Built `CheckoutScreen.tsx` with server-returned price lines (tickets, fee, total), live countdown timer using server `expiresAt`, `TEST MODE` badge, cancellation auto-refund policy notice, and `Release seats` action via `DELETE /showtimes/:id/holds`. Handled `Idempotency-Key` generated without `Math.random` (`generateIdempotencyKey`), opened Flutterwave checkout via `openPaymentBrowser`, and polled `GET /tickets` for confirmation up to 60s max. Handled hold expired, confirming, and timeout states.
  - **Task 6 (Ticket Screen)**: Built `TicketScreen.tsx` with movie/cinema/seat details, status chip (Active, Used, Cancelled with refund line notice), and dynamic 256-bit QR reference requested on every open via `POST /tickets/:id/qr` kept strictly in memory. Provided refresh QR button and pure-JS SVG matrix QR renderer `QrCodeView.tsx`.
  - **Task 7 (My Tickets Screen & Header Navigation)**: Built `MyTicketsScreen.tsx` with upcoming-first ticket list, pull-to-refresh, status badges, and empty state with browse action. Added "My tickets" button to `MoviesHomeScreen.tsx` header next to "Sign out". Wired all routes in `App.tsx`.
  - **Task 8 (Money Helper, Contracts & Tests)**: Created `app/src/utils/money.ts` (`formatKoboToNaira`), `contracts/cinema-cases.json`, and `app/src/__tests__/cinemaContract.test.ts` asserting schema contracts, integer kobo arithmetic, 6-seat limit, RFC 4122 v4 UUID format, absence of `Math.random`, 4s/3s/60s polling rules, and zero hardcoded hex colours.

- **Phase 6 Server Repair Pass (Syntax Repair, File Audit & Production Env Test Fixtures)**:
  - **Task 1 (Repair jobs.ts & Audit Fix Pass 2 Files)**:
    - Restored `export interface ProcessWebhookResult` header in `server/src/lib/jobs.ts`, resolving the syntax error at lines 71–74 that prevented server compilation.
    - Verified all Fix Pass 2 behavior in `jobs.ts` remains intact: `checkTransactionMismatch` pure validator, transaction verification re-query, payment flagging on discrepancy, natural hold expiration without seat confirmation, and zero forbidden ledger inserts.
    - Audited all 9 files touched in Fix Pass 2:
      - `server/src/lib/jobs.ts`: `repaired`
      - `server/src/lib/flutterwave.ts`: `ok`
      - `server/src/lib/session.ts`: `ok`
      - `server/src/env.ts`: `ok`
      - `server/src/routes/checkout.ts`: `ok`
      - `server/src/routes/showtimes.ts`: `ok`
      - `server/src/routes/tickets.ts`: `ok`
      - `server/src/__tests__/webhooksTickets.test.ts`: `ok`
      - `server/migrations/004_payments_flagged_status.sql`: `ok`
  - **Task 2 (Production Env Test Fixtures & Key Validation Test)**:
    - Updated production env test fixtures in `server/src/__tests__/checkout.test.ts` and `server/src/__tests__/env.test.ts` by supplying dummy non-empty values for `FLUTTERWAVE_SECRET_HASH` and `FLUTTERWAVE_SECRET_KEY` so the `PAYMENT_SIMULATOR must be false in production` assertion triggers cleanly without masking.
    - Added comprehensive unit test in `server/src/__tests__/env.test.ts` asserting that production boot fails when either key is missing, empty, or whitespace-only, and confirming that the fatal error message outputs KEY NAMES ONLY (Rule 02: never leak secret values).
  - **Task 3 (Test Inventory for webhooksTickets.test.ts)**:
    - Compiled exhaustive inventory of all 16 tests across 5 describe blocks in `server/src/__tests__/webhooksTickets.test.ts` covering webhook signatures, transaction mismatch, ticket status literals, auth 401 rethrow boundary, and currency/admin utilities.

- **Phase 7 Type & Test Fix Pass (Server Import, SeatMap Types & Test Suite Isolation)**:
  - **Task 1 (Import nairaToKobo in jobs.ts)**: Imported `nairaToKobo` from `./flutterwave.js` in `server/src/lib/jobs.ts`, preserving exact integer kobo arithmetic without code duplication.
  - **Task 2 (SeatMap.tsx TypeScript Errors)**:
    - Defensively initialized `appStateRef` with `AppState.currentState || 'active'` in `app/src/components/SeatMap.tsx` to handle `string | null | undefined`.
    - Replaced non-existent `radius.xs` with valid design token `radius.sm`.
    - Explicitly typed `let stateLabel: string` preventing type inference lock to literal `'Available'`.
  - **Task 3 (cinemaContract.test.ts React Native Import Isolation)**:
    - Isolated `MAX_SEATS_PER_BOOKING = 6` constant definition into `app/src/schemas/cinema.ts` and re-exported from `app/src/components/SeatMap.tsx`.
    - Updated `app/src/__tests__/cinemaContract.test.ts` to import `MAX_SEATS_PER_BOOKING` from `../schemas/cinema` instead of `../components/SeatMap`. This resolved the `Expected 'from', got 'typeOf'` syntax error caused by Node.js Vitest loading Flow syntax in `react-native/index.js:27`. Verified `SeatMap.tsx` component implementation via `fs.readFileSync`.

- **Phase 7 App Refinement & Math.random Exclusion Pass**:
  - **Task 1 (SeatMap AppStateStatus Type Cast)**:
    - Updated `appStateRef` in `app/src/components/SeatMap.tsx` to `useRef<AppStateStatus>((AppState.currentState as AppStateStatus) || 'active')`, satisfying strict TypeScript typing where `AppState.currentState` is typed as `string`.
  - **Task 2 (Math.random Comment Rewording & Absence Audit)**:
    - Reworded comments in `app/src/utils/crypto.ts` to remove the string literal `"Math.random"` while keeping cryptographic guarantees and behavior unchanged.
    - Audited all of `app/src`: verified zero occurrences remain in application source files, with the only mentions isolated to the contract test suite in `app/src/__tests__/cinemaContract.test.ts` where the absence of the identifier is explicitly asserted.

- **Phase 7 Movies Header Restyle — Option B**:
  - **Task 1 (Header Pills & TicketIcon Component)**:
    - Built `TicketIcon.tsx` vector component using `react-native-svg` rendering a ticket outline with side notches and an internal dashed divider using `colors.on_primary`. Exported from `components/index.ts`, documented in `COMPONENTS.md`, and mounted in `ComponentGalleryScreen.tsx`.
    - Restyled "My tickets" in `MoviesHomeScreen.tsx` as a filled pill: fill `colors.primary`, icon & label `colors.on_primary`, bold 700 text, height 44 pt, fully rounded `radius.full`.
    - Restyled "Sign out" in `MoviesHomeScreen.tsx` as a quiet outlined pill: border `colors.outline_variant`, label `colors.on_surface_variant` (muted text token, removing previous error/orange styling), height 44 pt, fully rounded `radius.full`.
    - Configured gap with `spacing.sm` (8 pt) and `flexShrink: 0` on `headerRightContainer`, guaranteeing that neither button clips while screen title truncates gracefully if space is constrained at 320 pt or large font sizes.
    - Added static contract test suite in `app/src/__tests__/moviesContract.test.ts` verifying absence of hex colours, string key reuse, accessibility roles, and pill styling.

- **Phase 7 Wordmark Chevron Lettering & App Icon Pass (14 Nov 2026)**:
  - **Task 1 (A1 Chevron Filled Lettering for Wordmark, ClapperMark & WelcomeHero)**:
    - In `app/src/components/Wordmark.tsx`: Replaced `WORDMARK_PATHS` with four filled paths (`A, V, U, E`) with no transform or stroke props. Exported `WORDMARK_BOX = { w: 578, h: 111, top: 1.5, bottom: 109 }`. Updated `WordmarkName` with `viewBox="0 0 578 111"`, `aspectRatio = 578 / 111`, and rendered `<Path fill={activeColor}>` without stroke properties.
    - In `app/src/components/ClapperMark.tsx`: Updated imports to include `WORDMARK_BOX`. Updated letter geometry to `nameW = 0.64 * boardW` (69.12), `nameScale = nameW / WORDMARK_BOX.w` (0.11958), and centered the letters vertically and horizontally inside the panel with `(WORDMARK_BOX.bottom - WORDMARK_BOX.top) * nameScale`, achieving identical 12.42 pt margins on all four sides. Replaced stroked `<G>` with `<G fill={nameColor}>` over `WORDMARK_PATHS.map((item) => <Path key={item.id} d={item.d} />)`.
    - In `app/src/components/WelcomeHero.tsx`: Updated imports to include `WORDMARK_BOX`. Applied identical 64% board width and 4-sided centering geometry inside the clapperboard dark panel. Replaced stroked `<G>` with `<G fill={nameColor}>` over `WORDMARK_PATHS.map((item) => <Path key={item.id} d={item.d} />)`.
    - Result across all marks: Peach chevron "A" (no crossbar, no stray bar), followed by V, U, E, cleanly filled with `colorData.palettes.primary['80']` (#FFCEBE).
  - **Task 2 (App Icon Configuration)**:
    - In `app/app.json`: Updated `icon` property from `./assets/logo/a-vue-logo-dark.png` to `./assets/logo/a-vue-icon-1024.png`. Left `android.adaptiveIcon` unchanged with dark background `#1A110F`.
    - In `app/app.config.ts`: Updated default fallback `icon` from `./assets/logo/a-vue-logo-dark.png` to `./assets/logo/a-vue-icon-1024.png`. Left `android.adaptiveIcon` unchanged.
  - **Task 3 (Wordmark Paths & Logo Test Suite)**:
    - Added `app/src/__tests__/wordmarkPaths.test.ts` covering:
      1. `WORDMARK_PATHS` contains identifiers `'A', 'V', 'U', 'E'` where each `d` starts with `'M'` and ends with `'Z'`, and verifies `WORDMARK_BOX` dimensions.
      2. Source text of `Wordmark.tsx`, `ClapperMark.tsx`, and `WelcomeHero.tsx` contains no `strokeWidth` for the wordmark, and no stroke props on `WORDMARK_PATHS`.
      3. `nameColor` comes strictly from design token `colorData.palettes.primary['80']` (#FFCEBE).

- **Phase 7 Movies Header Option A & Wordmark Test Fix Pass (14 Nov 2026)**:
  - **Task 1 (wordmarkPaths.test.ts React Native Import Decoupling)**:
    - Removed React Native component import (`../components/Wordmark`) from `app/src/__tests__/wordmarkPaths.test.ts`.
    - Used `fs.readFileSync` to parse `Wordmark.tsx` text and extract `WORDMARK_PATHS` (`id`, `d`) and `WORDMARK_BOX` (`w`, `h`, `top`, `bottom`) using regular expressions.
    - Preserved all existing assertions with unchanged meaning, preventing Vitest from attempting to load Flow syntax in React Native internals.
  - **Task 2 (Movies Header Option A Alignment in ScreenShell & MoviesHomeScreen)**:
    - Added optional `titleAlign?: 'center' | 'left'` (defaults to `'center'`) and `headerInset?: number` (defaults to `spacing.base`) to `ScreenShell.tsx`.
    - When `titleAlign === 'center'`, the header layout remains pixel-identical to prior screens with centered title in `headerCenter` and symmetrical 80 pt minimum slots.
    - When `titleAlign === 'left'`, the title renders in `headerLeft` with left alignment, `numberOfLines={1}`, `flexShrink: 1`, typography `titleLargeReduced` (fontFamily, fontSize, fontWeight), and color `colors.on_surface`, leaving `headerRight` right-aligned with `flexShrink: 0`.
    - In `MoviesHomeScreen.tsx`, passed `titleAlign="left"` and `headerInset={spacing.base}` to `ScreenShell`, aligning the left edge of the "Movies" title and the right edge of the "Sign out" pill with the exact card grid inset on 360 pt screens and larger without overlap.
  - **Task 3 (Source-Text Contract Test for Movies Header)**:
    - Added `app/src/__tests__/moviesHeader.test.ts` verifying that `ScreenShell.tsx` declares `titleAlign` and `headerInset` with default `'center'`, `MoviesHomeScreen.tsx` passes `titleAlign="left"` and `headerInset={spacing.base}`, no other screen file contains `titleAlign`, and `ScreenShell` uses `typography.titleLargeReduced` for the left variant.

- **Phase 7 Movies Header Inset Alignment & Guaranteed Spacing Pass (14 Nov 2026)**:
  - **Task (Movies Header Outer Inset & Spacing Hardening)**:
    - Analyzed the movie card's real outer horizontal inset from the screen edge: `ScreenShell` fixed content padding (`spacing.base` = 16 pt) + `FlatList` `contentContainerStyle` padding (`spacing.base` = 16 pt) = `spacing.base + spacing.base` (32 pt), verifying zero horizontal padding/margins on `columnWrapperStyle`, `cardWrapper`, and `MovieCard`.
    - In `MoviesHomeScreen.tsx`, defined `cardGridInset = spacing.base + spacing.base` and passed `headerInset={cardGridInset}` to `ScreenShell`.
    - In `ScreenShell.tsx`, applied `headerInset` to both sides of the header (`paddingLeft: effectiveHeaderInset, paddingRight: effectiveHeaderInset`), aligning the left edge of the "Movies" title and the right edge of the "Sign out" pill with the exact 32 pt card grid edge.
    - Hardened the left-aligned layout in `ScreenShell.tsx`:
      - Left title container has `flex: 1`, `flexShrink: 1`, `minWidth: 0`, and `marginRight: spacing.base` (guaranteed 16 pt minimum gap to pills).
      - Title text uses `numberOfLines={1}` and `ellipsizeMode="tail"`, guaranteeing truncation over any overlap.
      - Right pills cluster maintains `flexShrink: 0` without absolute positioning, negative margins, or z-index layering.
    - Updated `moviesHeader.test.ts` (source-text only) asserting token derivation of `headerInset`, title `marginRight` spacing token, `flexShrink: 1`, `numberOfLines={1}`, `ellipsizeMode="tail"`, `flexShrink: 0` on pills, and absence of absolute positioning.

- **Phase 7 Showtimes Movie Header Pass (14 Nov 2026)**:
  - **Task (Showtimes Movie Header Container & Poster Fallback)**:
    - Replaced flat miniHeader bar in `ShowtimesScreen.tsx` with a rounded container using `colors.surface_container_low`, `radius.md`, `spacing.sm` padding, and `spacing.base` horizontal margin.
    - Configured movie poster image on the left with fixed 2:3 aspect ratio, 56 pt width, rounded corners (`radius.sm`), and accessibilityLabel `STRINGS.showtimes.posterAccessibilityLabel(movieTitle)` from `strings.ts`.
    - Configured title container beside the poster with `flex: 1`, `minWidth: 0`, `numberOfLines={2}`, `ellipsizeMode="tail"`, typography `titleMedium`, and color `colors.on_surface`.
    - Added conditional meta row displaying release year (`bodySmall`, `on_surface_variant`) and star rating (`labelSmall` bold, `primary`) only when data is provided.
    - Implemented graceful no-poster fallback branch: when `posterUrl` is unavailable or `onError` triggers, the same container renders without an image and with the title left-aligned without breaking layout.
    - Investigated movie data availability on `ShowtimesScreen`: confirmed that `App.tsx` routes to `ShowtimesScreen` passing only `movieId` and `movieTitle`, and `cinemaClient.getMovieShowtimes(movieId)` returns only showtime schedules without movie poster, year, or rating. Per Rule 6, no new network requests or navigation changes were made, and the fallback branch is active in runtime.
    - Added source-text contract test `showtimesHeader.test.ts` verifying container styling tokens, poster accessibility label, title truncation, fallback branch, and zero hex color literals.

- **Phase 7 Movie Metadata Propagation to Showtimes Pass (14 Nov 2026)**:
  - **Task (Movies to Showtimes Poster, Year & Rating Wiring)**:
    - Extended movie selection in `MoviesHomeScreen.tsx`: defined `MovieSelectParams` carrying `movieId: number`, `movieTitle: string`, `posterUrl?: string`, `releaseYear?: string`, and `voteAverage?: number`. In `renderItem`, `handleSelectMovie` formats `posterUrl` via `moviesClient.getPosterUrl('w342', movie.posterPath)` and `releaseYear` via `movie.releaseDate.split('-')[0]`, matching the MovieCard component exactly without invented fields.
    - Extended application state in `App.tsx`: added `selectedMoviePosterUrl`, `selectedMovieReleaseYear`, and `selectedMovieVoteAverage` state hooks. Updated `onSelectMovie` to receive and persist these three values upon movie selection.
    - Wired props to `ShowtimesScreen` in `App.tsx`: passed `posterUrl={selectedMoviePosterUrl}`, `releaseYear={selectedMovieReleaseYear}`, and `voteAverage={selectedMovieVoteAverage}`.
    - Path auditing:
      - Path `movies` -> `movie_detail` -> `showtimes`: passes `posterUrl`, `releaseYear`, and `voteAverage` from the initial selection, rendering full poster, year, and rating in `ShowtimesScreen`.
      - Direct/other paths (e.g. if opened without prior selection): leaves props `undefined`, cleanly triggering the fallback container.
    - Verified `ShowtimesScreen.tsx`: exact type alignment with `ShowtimesScreenProps`, zero changes required.
    - Added source-text contract test `moviesToShowtimes.test.ts` verifying state declaration, prop wiring, and selection callback schema.

- **Phase 7 Typecheck & Test Path Fix Pass (14 Nov 2026)**:
  - **Fix 1 (MoviesHomeScreen posterUrl Type & TBA String Token)**:
    - Fixed `MoviesHomeScreen.tsx` typecheck error where `moviesClient.getPosterUrl(...)` returning `string | null` resulted in type `'string | null | undefined'`, which was unassignable to `MovieSelectParams.posterUrl?: string`. Converted `null` to `undefined` via `(moviesClient.getPosterUrl('w342', movie.posterPath) ?? undefined)`.
    - Moved hardcoded `'TBA'` fallback in `handleSelectMovie` to `constants/strings.ts` under `STRINGS.movies.tba`, maintaining zero hardcoded UI strings.
    - Reported finding (no fix per Rule 1 scope lock): `MovieCard.tsx` line 44 also contains a hardcoded `'TBA'` literal.
  - **Fix 2 (moviesToShowtimes.test.ts Path Resolution)**:
    - Fixed `appPath` in `app/src/__tests__/moviesToShowtimes.test.ts` from `path.resolve(__dirname, '../../../App.tsx')` (which resolved to repo root `A VUE/App.tsx`) to `path.resolve(__dirname, '../../App.tsx')` pointing to `app/App.tsx`.
    - Preserved all assertion contracts without modification.

- **Phase 7 Cinema Seed Script Pass (14 Nov 2026)**:
  - **Task (Cinema, Halls, Screens, Seats & Showtimes Seed Script)**:
    - Analysed migrations 001 and 002 alongside `showtimes.ts`, `holds.ts`, `checkout.ts`, and `tickets.ts` queries: mapped exact schemas across `cinemas`, `screens`, `halls`, `seats`, and `showtimes`.
    - Created `server/scripts/seed-cinema.ts` with fixed deterministic UUIDs and data:
      - 2 Cinemas in Lagos: 'A VUE Cinema Victoria Island' and 'A VUE Cinema Ikeja City Mall'.
      - 2 Halls per cinema: one 80-seat hall (rows A-H, 10 per row) and one 50-seat hall (rows A-E, 10 per row for k6 load testing).
      - Populated both `screens` and `halls` tables identically to ensure full compatibility with polymorphic SQL joins (`LEFT JOIN screens`, `LEFT JOIN halls`).
      - Populated `seats` table with both migration 001 (`screen_id`, `row_label`, `seat_number`, `seat_type`) and migration 002 (`hall_id`, `"row"`, `"number"`, `accessible`) columns. Marked accessible wheelchair seats in row A (seats 1 and 2).
      - Resolved movie IDs from the existing backend Movies source (`getNowPlayingMovies`), supporting `process.env.MOVIE_IDS` and a curated fallback list when offline.
      - Scheduled showtimes across next 8 days starting today at 13:00, 16:30, and 20:00 Africa/Lagos time (+01:00) distributed across halls.
      - Integer kobo pricing (`priceKobo`) per hall: 350,000 kobo (3,500 NGN) and 450,000 kobo (4,500 NGN) in Cinema 1; 300,000 kobo (3,000 NGN) and 400,000 kobo (4,000 NGN) in Cinema 2. Zero cancelled showtimes.
    - Idempotency & Safety: Wrapped in a single database transaction (`BEGIN` / `COMMIT` / `ROLLBACK`). Every insert is guarded by `ON CONFLICT DO NOTHING` or `WHERE NOT EXISTS`. Never modifies or deletes existing rows. Prints row counts per table and never leaks credentials or connection strings.
    - Added npm script `"seed:cinema": "tsx scripts/seed-cinema.ts"` to `server/package.json`.
    - Added source-text test `server/src/__tests__/seedCinema.test.ts` verifying existence, npm script, transactions, idempotency guards, absence of `Math.random`, and absence of credential-like strings.

- **Phase 1 Visuals Pass (14 Nov 2026)**:
  - **Task 1.1 (Showtimes Footer Photo & Lettering Watermark)**:
    - In `ShowtimesScreen.tsx`, added full-width footer photo (`app/assets/photos/showtimes.jpg`, 1400:764 aspect ratio) after cinema cards with `marginTop: 'auto'`, sitting flush at the bottom for short content and scrolling below cinema cards on long lists.
    - Added top-edge gradient fade into `colors.background` using `react-native-svg` `LinearGradient` without `expo-linear-gradient`.
    - Added dimming overlay with token colour `colors.scrim` (`opacity: 0.35`) and `pointerEvents="none"`.
    - Drew A VUE lettering watermark in code reusing `WORDMARK_PATHS` and `WORDMARK_BOX` from `Wordmark.tsx` with name-colour token `colorData.palettes.primary['80']`, 120 pt wide, centered, opacity 0.2, hidden from screen readers.
    - Set `accessibilityRole="image"` and label from `STRINGS.showtimes.footerPhotoAccessibilityLabel` in `strings.ts`.
    - Added contract test `app/src/__tests__/showtimesFooter.test.ts`.
  - **Task 1.2 (Seat Map Photo & Fit-to-Width Grid)**:
    - Audited zoom logic: reported how `isZoomed` provides 44 pt touch targets (38 pt seat + 3 pt margins), preserved all zoom behavior and targets.
    - In `SeatMap.tsx`, derived cell size and margins dynamically from `useWindowDimensions().width`, screen padding (32 pt), row label column (24 pt), and `maxSeatsInRow` calculated from data (no hardcoded 10).
    - Top-aligned grid directly under Zoom button (`justifyContent: 'flex-start'`) and centered horizontally (`alignItems: 'center'`), preventing 80-seat halls from reaching the photo.
    - In `SeatMapScreen.tsx`, added background photo (`app/assets/photos/seat-map.jpg`, 1600:1203) cropped to bottom 45% (`overflow: 'hidden'`, height `windowWidth * 0.34`, image `bottom: 0`, `aspectRatio: 1600 / 1203`), positioned behind content above bottom bar with `pointerEvents="none"`, top fade to `colors.background`, and dim overlay with `colors.scrim`.
    - Preserved all five seat states (available, selected, held, sold, wheelchair), accessibility labels, and selection/hold logic.
    - Added contract test `app/src/__tests__/seatMapLayout.test.ts`.

- **Tasks (14 Nov 2026 - Branch `a-vue-2`)**:
  - **Task 1 (Seat Grid Alignment & Centering)**:
    - Fixed ~140pt top gap by switching `gridContentContainer` cross-axis alignment from `alignItems: 'center'` to `alignItems: 'flex-start'`.
    - Set Zoom button container `marginBottom: spacing.base` (16pt), placing Row A directly below the button.
    - Eliminated right margin asymmetry (38pt vs 16pt left) by setting `rowLabelColumnWidth = isZoomed ? 24 : 14` in fit mode, integer cell math (`Math.floor(rawSeatCellWidth)`), and horizontal centering `justifyContent: isZoomed ? 'flex-start' : 'center'`.
    - Traced seat discrepancy root cause: in `App.tsx`, the waiting room path updated `selectedSeatIds` but did not update `selectedSeats`, allowing stale selections from previous visits to display in Checkout.
    - Updated contract test `app/src/__tests__/seatMapLayout.test.ts`.
  - **Task 2 (Cinema Card Decorative Photos)**:
    - Verified all 4 marquee photos (`cinema-card-1.jpg` through `cinema-card-4.jpg`).
    - Assigned photos deterministically via modulo 4 over alphabetically sorted cinema IDs (`localeCompare`).
    - Positioned photo on right side of card (max 40% width, 90% height, top: '5%', right: 8, opacity 0.6, `pointerEvents="none"`) behind text.
    - Feathered all 4 edges into `colors.surface_container_low` using `react-native-svg` linear gradients.
    - Added accessibility label `STRINGS.showtimes.cinemaCardPhotoAccessibilityLabel`.
    - Added contract test `app/src/__tests__/showtimesCardImage.test.ts`.
  - **Task 3 (Conditional TEST MODE Badge)**:
    - Added `isFlutterwaveTestMode()` to `server/src/lib/flutterwave.ts` inspecting `PAYMENT_SIMULATOR` and `FLWSECK_TEST` key prefix with zero secret leakage.
    - Exposed `GET /checkout/config` returning `{ testMode }` and included `testMode` in `POST /checkout` responses.
    - Updated `CheckoutScreen.tsx` to conditionally render the "TEST MODE" badge pill only when `testMode === true`, with safe fallback to true if config request fails.
    - Added tests `server/src/__tests__/checkoutTestMode.test.ts` and `app/src/__tests__/checkoutBadge.test.ts`.
  - **Task 4 (Account Menu, Deletion Grace Period & Restore Flow)**:
    - Inspected migrations 001-004: documented all 7 FKs to `users` and personal data columns (`users.email`, `users.password_hash`, `auth_codes.email`).
    - Created migration `005_users_deletion_grace.sql` adding `deleted_at TIMESTAMPTZ`, `purge_after TIMESTAMPTZ`, and partial index `idx_users_purge_after`.
    - Added `DELETION_GRACE_DAYS` env config (default 30 days, min 1, max 90).
    - Implemented `releaseAllUserHolds()` in `holds.ts` and `sendAccountDeletionNoticeEmail()` in `mailer.ts`.
    - Implemented `POST /auth/delete`: requires auth, Zod validation `{ password, confirm: 'DELETE' }`, Argon2id verification, blocks with 409 `HAS_UPCOMING_TICKETS` if user has active tickets with `starts_at > NOW()`, runs in single DB transaction setting `deleted_at = NOW()` and `purge_after = NOW() + grace_interval`, deletes sessions and auth codes, releases Redis holds, revokes in-memory sessions, and dispatches deletion notice email.
    - Updated `POST /auth/signin`: blocks with 403 `ACCOUNT_SCHEDULED_FOR_DELETION` returning `purgeAfter`. Returns generic 401 if password invalid.
    - Implemented `POST /auth/restore`: email + password, clears `deleted_at` and `purge_after`, returns active session.
    - Implemented `POST /cron/purge-users`: secured via `CRON_SECRET` using `crypto.timingSafeEqual` with buffer length check. Anonymises users in place (`anon_<uuid>@deleted.invalid`, `!deleted_<uuid>`, status `'locked'`) without deleting bookings, tickets, payments, or ledger entries.
    - Built `AccountMenu.tsx`: 36pt button with 44pt tap target (`hitSlop`), popover with "Sign out" and danger "Delete account", 2-step deletion modal requiring exact "DELETE" confirmation, password input, and 30-day grace notice.
    - Integrated `AccountMenu` into `MoviesHomeScreen.tsx` header, replacing legacy "Sign out" pill.
    - Wired restore prompt modal in `App.tsx` via `authClient.onScheduledForDeletion` listener without touching `SignInScreen.tsx`.
    - Added tests `server/src/__tests__/accountDelete.test.ts` and `app/src/__tests__/accountDelete.test.ts`.
  - **Task A (Waiting Room Stale Seat List Fix)**:
    - Fixed seat list synchronization: `SeatMapScreen.tsx` passes both `selectedSeatIds` and `selectedSeats` to `onOpenWaitingRoom`.
    - In `App.tsx`, introduced `selectedSeatIdsRef` and `selectedSeatsRef` to eliminate closure staleness and ensure `onAdmitted` synchronizes `selectedSeats` to state and checkout.
    - Locked fix with unit test `app/src/__tests__/waitingRoomSeatCarry.test.ts`.
  - **Task B (Grace Notice Wording Update)**:
    - Reworded `STRINGS.account.deleteGracePeriodNotice` and `deleteSuccessMessage` to "Until then, sign in and tap Restore to keep it."
    - Kept single constant interpolation `ACCOUNT_DELETION_GRACE_DAYS = 30`.
    - Updated contract test `app/src/__tests__/accountDelete.test.ts`.


---

### Terminal Commands to Run (PowerShell)

```powershell
# 1. Install missing Expo packages in app (do not run unasked; run manually):
cd "c:\Users\SETUP\Desktop\A VUE\app"
npx expo install react-native-svg react-native-safe-area-context

# 2. Run app tests and typecheck:
npm run typecheck
npm test

# 3. Run server typecheck and test suite:
cd "c:\Users\SETUP\Desktop\A VUE\server"
npm run typecheck
npm test

# 4. Run rate-limit smoke test against running server:
# (Ensure server is started in another terminal: npm run dev)
npm run smoke:ratelimit
```
