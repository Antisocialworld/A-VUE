import React, { useState } from 'react';
import {
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Button, ScreenShell, WelcomeHero } from '../components';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';
import { getVisualCenteringCompensation } from '../constants/heroGeometry';
import colorData from '../tokens/color-tokens-orange-green-yellow.json';

export interface WelcomeScreenProps {
  onNavigateToSignIn: () => void;
  onNavigateToSignUp: () => void;
  onNavigateToGallery?: () => void;
}

/**
 * A VUE Welcome Screen
 *
 * Layout Structure:
 * 1. Floating Dev Gear Button:
 *    - Gated by __DEV__ flag (rendered ONLY in development builds)
 *    - Positioned in the top-right corner below status bar
 *    - Never overlaps any Welcome control
 * 2. Free Area (flex: 1, justifyContent: 'center'):
 *    - Vertically centered between top safe area and top edge of Sign in button
 *    - ScreenShell top padding overridden with paddingTop: 0
 *    - Upper group contains:
 *      a) HeroContainer: relative wrapper containing WelcomeHero (pointerEvents="none")
 *         and a sibling transparent overlay Pressable (position: 'absolute', zIndex: 10)
 *      b) Gap (spacing.lg)
 *      c) Tagline (typography.labelLarge, primary 80 in dark, on_surface in light, wrap centered)
 *      d) Gap (spacing.sm)
 *      e) Decorative rule (2 px high, centered, 40% of measured tagline width, same color token)
 *    - Compensated by 5 pt (visualCompensation) so the VISIBLE drawing (top of head to bottom of rule)
 *      is perfectly centered between top safe area and Sign in.
 * 3. Bottom Actions:
 *    - Pinned to bottom with safe-area handling
 *    - Sign in (solid primary) + gap (spacing.md) + Sign up (outlined 3px border)
 *    - Equal widths, flush edges
 */
export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  onNavigateToSignIn,
  onNavigateToSignUp,
  onNavigateToGallery,
}) => {
  const { colors, spacing, typography, mode } = useTheme();
  const [taglineWidth, setTaglineWidth] = useState<number>(0);

  // Dark theme: palette primary 80 (#FFCEBE). Light theme: on_surface token (#231917).
  const taglineColor =
    mode === 'dark' ? colorData.palettes.primary['80'] : colors.on_surface;

  // Visual centering compensation (5 pt derived from (topVisualPadding 8pt + fontLeading 2pt) / 2)
  const visualCompensation = getVisualCenteringCompensation(240);

  const handleTaglineLayout = (e: LayoutChangeEvent) => {
    const width = e.nativeEvent.layout.width;
    if (width > 0 && Math.abs(width - taglineWidth) > 1) {
      setTaglineWidth(width);
    }
  };

  return (
    <ScreenShell scrollable={false} contentContainerStyle={styles.shellContent}>
      {/* Dev-only floating blue gear button (Component Gallery shortcut, __DEV__ only) */}
      {__DEV__ && Boolean(onNavigateToGallery) && (
        <Pressable
          testID="dev-gallery-gear-button"
          accessibilityRole="button"
          accessibilityLabel="Development gallery shortcut"
          onPress={onNavigateToGallery}
          style={[
            styles.devGearButton,
            {
              top: spacing.md,
              right: spacing.base,
              backgroundColor: colorData.chart.light[3], // Design token blue: #0B4EB9
            },
          ]}
        >
          <Text style={styles.devGearIcon}>⚙</Text>
        </Pressable>
      )}

      {/* Free area: vertically centered between top safe area and top edge of Sign in button */}
      <View style={styles.freeArea}>
        <View
          style={[
            styles.heroGroup,
            { transform: [{ translateY: -visualCompensation }] },
          ]}
        >
          {/* Relative container holding hero art and sibling touch overlay */}
          <View style={styles.heroContainer}>
            {/* Hero artwork underneath (pointerEvents="none") */}
            <WelcomeHero
              width={240}
              pointerEvents="none"
              accessibilityLabel={STRINGS.appName}
            />

            {/* Sibling transparent Pressable overlay on top */}
            <Pressable
              onLongPress={onNavigateToGallery}
              delayLongPress={2000}
              accessible={false}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={styles.heroOverlayPressable}
            />
          </View>

          {/* Tagline: same typography token as button labels (typography.labelLarge) */}
          <Text
            allowFontScaling
            onLayout={handleTaglineLayout}
            style={[
              styles.tagline,
              {
                color: taglineColor,
                fontFamily: typography.labelLarge.fontFamily,
                fontSize: typography.labelLarge.fontSize,
                fontWeight: typography.labelLarge.fontWeight,
                lineHeight: typography.labelLarge.lineHeight,
                letterSpacing: typography.labelLarge.letterSpacing,
                marginTop: spacing.lg,
              },
            ]}
          >
            {STRINGS.welcome.subtitle}
          </Text>

          {/* Decorative rule: 2 px high, centered, 40% of measured tagline width */}
          <View
            accessible={false}
            aria-hidden={true}
            style={[
              styles.rule,
              {
                backgroundColor: taglineColor,
                width: taglineWidth > 0 ? taglineWidth * 0.4 : 0,
                marginTop: spacing.sm,
              },
            ]}
          />
        </View>
      </View>

      {/* Bottom Actions: Sign in and Sign up pinned to bottom with safe-area handling, equal widths */}
      <View
        style={[
          styles.actionsContainer,
          {
            paddingBottom: spacing.lg,
          },
        ]}
      >
        <Button
          title={STRINGS.welcome.signInAction}
          onPress={onNavigateToSignIn}
          variant="primary"
          accessibilityHint={STRINGS.welcome.signInAccessibilityHint}
          style={{ width: '100%', marginBottom: spacing.md }}
        />

        <Button
          title={STRINGS.welcome.signUpAction}
          onPress={onNavigateToSignUp}
          variant="outlined"
          accessibilityHint={STRINGS.welcome.signUpAccessibilityHint}
          style={{ width: '100%' }}
        />
      </View>
    </ScreenShell>
  );
};

const styles = StyleSheet.create({
  shellContent: {
    flex: 1,
    justifyContent: 'space-between',
    paddingTop: 0,
  },
  devGearButton: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    elevation: 6,
    shadowColor: '#002868',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  devGearIcon: {
    color: '#FFFFFF',
    fontSize: 22,
    lineHeight: 24,
  },
  freeArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  heroGroup: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroOverlayPressable: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
  },
  tagline: {
    textAlign: 'center',
    alignSelf: 'center',
  },
  rule: {
    height: 2,
    alignSelf: 'center',
  },
  actionsContainer: {
    width: '100%',
    alignItems: 'center',
  },
});
