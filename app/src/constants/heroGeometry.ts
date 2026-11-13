/**
 * A VUE Hero Composition Geometry
 * Coordinates extracted verbatim from a-vue-motion-long-5.5s.html.
 * Both the clapperboard and the character share ONE coordinate system on the stage.
 */

export interface BoundingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

export interface HeroViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HeroGeometry {
  groundLineY: number;
  boardBottomY: number;
  feetY: number;
  boundingBox: BoundingBox;
  viewBox: HeroViewBox;
  centreOffset: number;
}

export interface VerticalCenteringParams {
  screenHeight: number;
  topSafeArea: number;
  buttonTop: number;
  groupHeight: number;
  reservedTopSpace?: number; // ScreenShell default padding (spacing.base = 16 pt)
  visualCompensation?: number; // Offset applied to center visible artwork (5 pt)
  topVisualPadding?: number; // Invisible viewBox padding above projector head (8 pt)
  bottomVisualPadding?: number; // Invisible padding below rule (0 pt)
}

export interface VerticalCenteringResult {
  freeAreaTop: number;
  freeAreaBottom: number;
  freeAreaHeight: number;
  spaceAbove: number;
  spaceBelow: number;
  groupTop: number;
  difference: number;
  visibleSpaceAbove: number;
  visibleSpaceBelow: number;
  visibleDifference: number;
}

/**
 * Pure function computing the exact hero geometry, bounding box,
 * ground-line alignment, and horizontal centre offset.
 *
 * Drawn bounding box accounts for:
 * - Left edge of raised lid rotated -24° around (46, 88):
 *   Top-left corner reaches stage X = 80 + (46 - 16 * sin(24°)) = 119.492 ≈ 119.5
 * - Right edge of character ground shadow: stage X = 266 + 20 = 286.0
 * - Top of tilted projector head: stage Y = 54.0
 * - Bottom of ground shadow: stage Y = 190 + 5 = 195.0
 * - Ground line: stage Y = 190 (clapperboard bottom 132 + 58 = 190 and character feet 190)
 */
export function getHeroGeometry(): HeroGeometry {
  const groundLineY = 190;
  const boardBottomY = 190; // Clapperboard: y=132, height H=58 -> 132 + 58 = 190
  const feetY = 190;        // Character: translation y=190, feet sit on ground line 190

  // True bounding box of all drawn elements:
  const minX = 119.5; // Top-left corner of raised clapper lid
  const maxX = 286.0; // Rightmost edge of ground shadow
  const minY = 54.0;  // Top of projector head
  const maxY = 195.0; // Bottom of ground shadow

  const width = maxX - minX;   // 166.5 px
  const height = maxY - minY; // 141.0 px

  // Horizontal midpoint of drawn bounding box:
  const boundingBoxCenter = (minX + maxX) / 2; // 202.75

  // ViewBox: symmetrically centered on boundingBoxCenter (202.75)
  // Generous padding: 6.75 px horizontal, 6 px top, 5 px bottom
  const vbWidth = 180;
  const vbHeight = 152;
  const vbX = boundingBoxCenter - vbWidth / 2; // 202.75 - 90 = 112.75
  const vbY = 48;

  const viewBoxCenter = vbX + vbWidth / 2; // 202.75
  const centreOffset = boundingBoxCenter - viewBoxCenter; // Exactly 0

  return {
    groundLineY,
    boardBottomY,
    feetY,
    boundingBox: {
      minX,
      maxX,
      minY,
      maxY,
      width,
      height,
    },
    viewBox: {
      x: vbX,
      y: vbY,
      width: vbWidth,
      height: vbHeight,
    },
    centreOffset,
  };
}

/**
 * Computes top invisible viewBox padding above the projector head in points.
 * For width = 240, scale = 240 / 180 = 4/3.
 * Padding = (54 - 48) * (4/3) = 8.0 pt.
 */
export function getHeroTopVisualPadding(heroWidth = 240): number {
  const { boundingBox, viewBox } = getHeroGeometry();
  const scale = heroWidth / viewBox.width;
  return (boundingBox.minY - viewBox.y) * scale;
}

/**
 * Computes visual compensation in points needed to centre the VISIBLE drawing
 * (from top of projector head to bottom of rule) between top safe area and Sign in.
 * Top invisible space = 8.0 pt (viewBox) + 2.0 pt (font leading) = 10.0 pt.
 * Compensation = 10.0 pt / 2 = 5.0 pt (15 px at 3x).
 */
export function getVisualCenteringCompensation(heroWidth = 240): number {
  const topVisualPadding = getHeroTopVisualPadding(heroWidth); // 8.0 pt
  const fontBaselineOffset = 2.0; // font leading in labelLarge (lineHeight 20 - fontSize 14 = 6, half ~3)
  return (topVisualPadding + fontBaselineOffset) / 2; // 5.0 pt
}

/**
 * Pure function computing flex vertical centering of the upper group
 * within the free area between the top safe area and the top edge of the Sign in button.
 *
 * When reservedTopSpace is present (e.g. ScreenShell's default padding = 16 pt),
 * the free area starts lower than the safe-area edge.
 *
 * When visualCompensation (5 pt) is applied, the visible drawing
 * (top of projector head to bottom of rule) has equal gaps above and below within 1 pt.
 */
export function computeVerticalCentering(
  params: VerticalCenteringParams,
): VerticalCenteringResult {
  const reservedTop = params.reservedTopSpace ?? 0;
  const freeAreaTop = params.topSafeArea + reservedTop;
  const freeAreaBottom = params.buttonTop;
  const freeAreaHeight = Math.max(0, freeAreaBottom - freeAreaTop);
  const remainingSpace = Math.max(0, freeAreaHeight - params.groupHeight);
  const flexOffset = remainingSpace / 2;
  const compensation = params.visualCompensation ?? 0;
  const groupTop = freeAreaTop + flexOffset - compensation;

  // Space above & below layout box:
  const spaceAbove = groupTop - params.topSafeArea;
  const spaceBelow = params.buttonTop - (groupTop + params.groupHeight);

  // Visible space above (to top of head) & below (from bottom of rule to Sign in top):
  const topVisualPad = params.topVisualPadding ?? 0;
  const botVisualPad = params.bottomVisualPadding ?? 0;
  const visibleHeadY = groupTop + topVisualPad;
  const visibleRuleY = groupTop + params.groupHeight - botVisualPad;

  const visibleSpaceAbove = visibleHeadY - params.topSafeArea;
  const visibleSpaceBelow = params.buttonTop - visibleRuleY;

  return {
    freeAreaTop,
    freeAreaBottom,
    freeAreaHeight,
    spaceAbove,
    spaceBelow,
    groupTop,
    difference: Math.abs(spaceAbove - spaceBelow),
    visibleSpaceAbove,
    visibleSpaceBelow,
    visibleDifference: Math.abs(visibleSpaceAbove - visibleSpaceBelow),
  };
}
