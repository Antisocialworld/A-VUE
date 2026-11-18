import { Spacing } from '../tokens';

/** Web-only movie grid sizes. Spacing values come from the existing design tokens. */
export const WEB_CARD_MIN_WIDTH = 200;
export const WEB_GRID_GAP = Spacing.lg; // 20
export const WEB_GRID_SIDE_PADDING = Spacing.lg * 2; // 40
export const WEB_CONTENT_MAX_WIDTH = 560;

/** Pure column rule for the full-width web movie grid. */
export function getWebMovieColumns(width: number): number {
  const usableWidth = width - WEB_GRID_SIDE_PADDING * 2 + WEB_GRID_GAP;
  return Math.max(2, Math.floor(usableWidth / (WEB_CARD_MIN_WIDTH + WEB_GRID_GAP)));
}
