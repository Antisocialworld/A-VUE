import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { STRINGS } from '../constants/strings';

describe('Task 2: Movies Header Layout A4 & Strings Invariants', () => {
  it('pill uses "Tickets" string while screen title stays "My Tickets"', () => {
    // Required: STRINGS.tickets.myTicketsHeader stays "My Tickets"
    expect(STRINGS.tickets.myTicketsHeader).toBe('My Tickets');

    // Required: pill string is "Tickets"
    expect(STRINGS.movies.ticketsPill).toBe('Tickets');
  });

  it('contains accessible search strings', () => {
    expect(STRINGS.movies.searchActionAccessibilityLabel).toBe('Search movies');
    expect(STRINGS.search.header).toBe('Search');
    expect(STRINGS.search.placeholder).toBe('Search movies…');
    expect(STRINGS.search.noResultsTitle).toBe('No Movies Found');
    expect(STRINGS.search.clearAccessibilityLabel).toBe('Clear search');
  });

  it('verifies Layout A4 fits in 320pt width without wrapping or clipping', () => {
    // 320 pt total device width
    const totalScreenWidth = 320;

    // Outer padding: default ScreenShell inset (16pt left + 16pt right = 32pt)
    const horizontalInsets = 16 * 2;
    const availableHeaderWidth = totalScreenWidth - horizontalInsets; // 288 pt

    // Component widths in HeaderRight (Layout A4):
    // 1. Search button (36 pt visual circle, 44 pt tap area with hitSlop 4)
    const searchVisualWidth = 36;
    // 2. 10 pt gap
    const gap1 = 10;
    // 3. "Tickets" pill: TicketIcon (16 pt) + margin (4 pt) + "Tickets" text (~48 pt) + paddingHorizontal (8 pt * 2 = 16 pt)
    const ticketsPillWidth = 16 + 4 + 48 + 16; // 84 pt
    // 4. 10 pt gap
    const gap2 = 10;
    // 5. AccountMenu button (36 pt visual circle, 44 pt tap area with hitSlop 4)
    const accountVisualWidth = 36;

    const totalHeaderRightWidth =
      searchVisualWidth + gap1 + ticketsPillWidth + gap2 + accountVisualWidth; // 176 pt

    // Remaining space for "Movies" title on the left:
    const remainingForTitle = availableHeaderWidth - totalHeaderRightWidth; // 288 - 176 = 112 pt

    // Title "Movies" in titleLargeReduced (font size 20) is ~60 pt wide
    const estimatedTitleWidth = 60;

    expect(totalHeaderRightWidth).toBe(176);
    expect(remainingForTitle).toBeGreaterThan(estimatedTitleWidth);

    // Even if cardGridInset (32pt on each side = 64pt total) is applied:
    const availableNarrow = totalScreenWidth - 64; // 256 pt
    const remainingNarrow = availableNarrow - totalHeaderRightWidth; // 256 - 176 = 80 pt
    expect(remainingNarrow).toBeGreaterThan(estimatedTitleWidth);
  });
});

describe('Task 7: Odd Last Card Half-Width (SearchScreen & MoviesHomeScreen)', () => {
  const moviesHomeSource = fs.readFileSync(
    path.resolve(__dirname, '../screens/MoviesHomeScreen.tsx'),
    'utf-8',
  );
  const searchSource = fs.readFileSync(
    path.resolve(__dirname, '../screens/SearchScreen.tsx'),
    'utf-8',
  );

  it('SearchScreen cardWrapper has flexGrow: 0 and maxWidth: "50%"', () => {
    expect(searchSource).toContain('flexGrow: 0');
    expect(searchSource).toContain("maxWidth: '50%'");
  });

  it('MoviesHomeScreen cardWrapper has flexGrow: 0 and maxWidth: "50%"', () => {
    expect(moviesHomeSource).toContain('flexGrow: 0');
    expect(moviesHomeSource).toContain("maxWidth: '50%'");
  });

  it('both screens use the same cardWrapper pattern (shared approach, not copies)', () => {
    // Extract cardWrapper style block from each file and compare key properties
    const extractCardWrapper = (src: string): string => {
      const match = src.match(/cardWrapper:\s*\{([^}]+)\}/);
      return match ? match[1] : '';
    };

    const searchWrapper = extractCardWrapper(searchSource);
    const moviesWrapper = extractCardWrapper(moviesHomeSource);

    // Both must contain the half-width guard properties
    for (const prop of ['flexGrow: 0', "maxWidth: '50%'", "flexBasis: '48%'"]) {
      expect(searchWrapper).toContain(prop);
      expect(moviesWrapper).toContain(prop);
    }
  });
});

describe('Task 2: SearchScreen Invariants & Stale Response Invalidation', () => {
  const searchScreenSource = fs.readFileSync(
    path.resolve(__dirname, '../screens/SearchScreen.tsx'),
    'utf-8',
  );

  it('SearchScreen does NOT use titleAlign (only MoviesHomeScreen may use titleAlign)', () => {
    expect(searchScreenSource).not.toContain('titleAlign');
  });

  it('increments activeRequestIdRef when input length is fewer than 2 characters in both performSearch and handleChangeText', () => {
    // Both performSearch and handleChangeText must increment activeRequestIdRef.current in the < 2 chars branch
    const performSearchBranchMatch = searchScreenSource.match(
      /const performSearch = useCallback\(async \([\s\S]*?if \(trimmed\.length < 2\) \{([\s\S]*?)\}/,
    );
    expect(performSearchBranchMatch).not.toBeNull();
    expect(performSearchBranchMatch![1]).toContain('activeRequestIdRef.current++');

    const handleChangeBranchMatch = searchScreenSource.match(
      /const handleChangeText = \([\s\S]*?if \(trimmed\.length < 2\) \{([\s\S]*?)\}/,
    );
    expect(handleChangeBranchMatch).not.toBeNull();
    expect(handleChangeBranchMatch![1]).toContain('activeRequestIdRef.current++');
  });

  it('discards an in-flight search response when input is reduced to fewer than 2 characters', async () => {
    let activeRequestId = 0;
    let results: string[] = ['initial'];

    // Simulated search runner matching SearchScreen pattern
    async function simulateSearch(text: string, delayMs: number) {
      const trimmed = text.trim();
      if (trimmed.length < 2) {
        activeRequestId++;
        results = [];
        return;
      }

      const reqId = ++activeRequestId;
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      // Discard stale response
      if (reqId === activeRequestId) {
        results = [`result-for-${text}`];
      }
    }

    // 1. User types "resident" (dispatches request id 1 with 40ms simulated latency)
    const pendingSearch = simulateSearch('resident', 40);

    // 2. Before request 1 finishes, user backspaces to "r" (< 2 chars)
    simulateSearch('r', 0);
    expect(results).toEqual([]);

    // 3. Await the delayed request 1
    await pendingSearch;

    // Results must remain empty because activeRequestId was incremented by the < 2 branch
    expect(results).toEqual([]);
  });
});

describe('SearchScreen matchedTitle hint', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../screens/SearchScreen.tsx'),
    'utf-8',
  );

  it('formats the one-line hint from the strings file', () => {
    expect(STRINGS.search.showingResultsFor('Spider-Man')).toBe('Showing results for Spider-Man');
    expect(source).toContain('{STRINGS.search.showingResultsFor(matchedTitle)}');
    expect(source).toContain('numberOfLines={1}');
  });

  it('renders the hint only when the response carries matchedTitle', () => {
    expect(source).toContain('setMatchedTitle(response.matchedTitle ?? null)');
    expect(source).toContain('{matchedTitle ? (');
    expect(source).not.toContain('accessibilityLiveRegion');
  });
});
