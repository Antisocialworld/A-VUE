import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  computeVerticalCentering,
  getHeroGeometry,
  getHeroTopVisualPadding,
  getVisualCenteringCompensation,
} from '../constants/heroGeometry';

/**
 * Hero Layout & Visual Geometry Tests
 * Validates TASK 6, TASK 7, TASK 8, and TASK 9 alignment and centring invariants:
 * 1. Clapperboard bottom edge and character feet sit on the exact same ground line (y = 190).
 * 2. All drawn artwork falls entirely within the viewBox with zero clipping.
 * 3. Horizontal centre offset is exactly 0, computed from the drawn bounding box (minX 119.5 to maxX 286).
 * 4. Upper group vertical centring: models ScreenShell reserved top space (16 pt) vs eliminated padding (0 pt).
 * 5. Visible group vertical centring (Task 9e): compensates 5 pt residual offset so visible head-to-rule gaps are equal within 1 pt.
 * 6. Static test (Task 9d): WelcomeScreen has sibling transparent overlay Pressable with delayLongPress 2000 and matching handler.
 */
describe('WelcomeHero Layout & Geometry', () => {
  describe('Ground Line Alignment', () => {
    it('aligns clapperboard bottom edge and character feet on the exact same ground line', () => {
      const geometry = getHeroGeometry();

      expect(geometry.boardBottomY).toBe(geometry.feetY);
      expect(geometry.boardBottomY).toBe(geometry.groundLineY);
      expect(geometry.feetY).toBe(190);
      expect(geometry.groundLineY).toBe(190);
    });
  });

  describe('Drawn Bounding Box & Zero Clipping', () => {
    it('contains all drawn elements strictly inside the viewBox with zero clipping', () => {
      const geometry = getHeroGeometry();
      const { boundingBox, viewBox } = geometry;

      const viewBoxMaxX = viewBox.x + viewBox.width;
      const viewBoxMaxY = viewBox.y + viewBox.height;

      // Left edge (lid top-left corner at 119.5)
      expect(boundingBox.minX).toBeGreaterThanOrEqual(viewBox.x);
      // Right edge (ground shadow at 286.0)
      expect(boundingBox.maxX).toBeLessThanOrEqual(viewBoxMaxX);
      // Top edge (projector head at 54.0)
      expect(boundingBox.minY).toBeGreaterThanOrEqual(viewBox.y);
      // Bottom edge (shadow bottom at 195.0)
      expect(boundingBox.maxY).toBeLessThanOrEqual(viewBoxMaxY);

      // Verify positive padding on all four boundaries
      expect(boundingBox.minX - viewBox.x).toBeGreaterThan(0);
      expect(viewBoxMaxX - boundingBox.maxX).toBeGreaterThan(0);
      expect(boundingBox.minY - viewBox.y).toBeGreaterThan(0);
      expect(viewBoxMaxY - boundingBox.maxY).toBeGreaterThan(0);
    });

    it('exposes correct drawn bounding box dimensions from true path geometry', () => {
      const geometry = getHeroGeometry();

      expect(geometry.boundingBox).toEqual({
        minX: 119.5,
        maxX: 286.0,
        minY: 54.0,
        maxY: 195.0,
        width: 166.5,
        height: 141.0,
      });

      expect(geometry.viewBox).toEqual({
        x: 112.75,
        y: 48,
        width: 180,
        height: 152,
      });
    });
  });

  describe('Horizontal Centring', () => {
    it('has a horizontal centre offset of exactly 0 computed from the drawn bounding box', () => {
      const geometry = getHeroGeometry();

      const boundingBoxCenter = (geometry.boundingBox.minX + geometry.boundingBox.maxX) / 2;
      const viewBoxCenter = geometry.viewBox.x + geometry.viewBox.width / 2;

      expect(boundingBoxCenter).toBe(202.75);
      expect(viewBoxCenter).toBe(202.75);
      expect(geometry.centreOffset).toBe(0);
      expect(boundingBoxCenter - viewBoxCenter).toBe(0);
    });
  });

  describe('Vertical Centring & Reserved Top Space Modeling (Task 8a)', () => {
    it('models how uncompensated ScreenShell default padding (16 pt) creates a top-heavy imbalance', () => {
      const uncompensated = computeVerticalCentering({
        screenHeight: 800,
        topSafeArea: 48,
        buttonTop: 650,
        groupHeight: 240,
        reservedTopSpace: 16,
      });

      expect(uncompensated.difference).toBe(16);
      expect(uncompensated.spaceAbove - uncompensated.spaceBelow).toBe(16);
    });

    it('proves layout box space above equals space below within 1 unit when reserved top space is 0 (paddingTop: 0)', () => {
      const compensated = computeVerticalCentering({
        screenHeight: 800,
        topSafeArea: 48,
        buttonTop: 650,
        groupHeight: 240,
        reservedTopSpace: 0,
      });

      expect(compensated.difference).toBeLessThanOrEqual(1);
      expect(compensated.spaceAbove).toBe(compensated.spaceBelow);
    });
  });

  describe('Visible Group Centring & 5 pt Residual Compensation (Task 9e)', () => {
    it('computes top invisible viewBox padding as 8 pt from path geometry', () => {
      const topPadding = getHeroTopVisualPadding(240);
      expect(topPadding).toBe(8.0);
    });

    it('computes visual compensation as 5 pt derived from heroGeometry and typography leading', () => {
      const compensation = getVisualCenteringCompensation(240);
      expect(compensation).toBe(5.0);
    });

    it('asserts visible space above (to head) equals visible space below (from rule to button) within 1 pt', () => {
      // iPhone 3x scenario matching device screenshot (topSafeArea: 47, buttonTop: 700)
      const result = computeVerticalCentering({
        screenHeight: 844,
        topSafeArea: 47,
        buttonTop: 700,
        groupHeight: 252.67,
        reservedTopSpace: 0,
        visualCompensation: 5.0,
        topVisualPadding: 8.0,
        bottomVisualPadding: -2.0, // Accounts for font leading distribution below baseline
      });

      expect(result.visibleDifference).toBeLessThanOrEqual(1);
      expect(Math.abs(result.visibleSpaceAbove - result.visibleSpaceBelow)).toBeLessThanOrEqual(1);
    });

    it('verifies visible centering holds across varied mobile screen heights with 5 pt compensation', () => {
      const scenarios = [
        { screenHeight: 667, topSafeArea: 20, buttonTop: 540, groupHeight: 220 }, // Small phone
        { screenHeight: 844, topSafeArea: 47, buttonTop: 700, groupHeight: 252.67 }, // Standard phone
        { screenHeight: 926, topSafeArea: 50, buttonTop: 780, groupHeight: 260 }, // Large phone
      ];

      for (const scenario of scenarios) {
        const result = computeVerticalCentering({
          ...scenario,
          reservedTopSpace: 0,
          visualCompensation: 5.0,
          topVisualPadding: 8.0,
          bottomVisualPadding: -2.0,
        });

        expect(result.visibleDifference).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('Hero Long-Press Handler & Sibling Overlay Static Test (Task 9d)', () => {
    it('verifies transparent overlay Pressable is a sibling of WelcomeHero with delayLongPress 2000 and matching handler', () => {
      const welcomePath = path.resolve(__dirname, '../screens/WelcomeScreen.tsx');
      const welcomeContent = fs.readFileSync(welcomePath, 'utf-8');

      // 1. delayLongPress={2000} exists
      expect(welcomeContent).toContain('delayLongPress={2000}');

      // 2. onLongPress uses onNavigateToGallery (same handler as gear button)
      expect(welcomeContent).toContain('onLongPress={onNavigateToGallery}');
      expect(welcomeContent).toContain('onPress={onNavigateToGallery}');

      // 3. WelcomeHero exists with pointerEvents="none"
      expect(welcomeContent).toContain('<WelcomeHero');
      expect(welcomeContent).toContain('pointerEvents="none"');

      // 4. Verify overlay Pressable is a sibling of WelcomeHero inside heroContainer
      const heroContainerIndex = welcomeContent.indexOf('styles.heroContainer');
      const heroIndex = welcomeContent.indexOf('<WelcomeHero', heroContainerIndex);
      const overlayPressableIndex = welcomeContent.indexOf('styles.heroOverlayPressable', heroContainerIndex);
      const closeContainerIndex = welcomeContent.indexOf('</View>', overlayPressableIndex);

      expect(heroContainerIndex).toBeGreaterThan(-1);
      expect(heroIndex).toBeGreaterThan(heroContainerIndex);
      expect(overlayPressableIndex).toBeGreaterThan(heroIndex);
      expect(closeContainerIndex).toBeGreaterThan(overlayPressableIndex);
    });
  });
});
