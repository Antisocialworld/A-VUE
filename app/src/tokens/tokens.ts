/**
 * A VUE Design Tokens
 * Source of truth: JSON design files in this directory.
 * Do not invent or alter colours or dimensions.
 */

import colorData from './color-tokens-orange-green-yellow.json';
import radiusData from './design-tokens.radius.json';
import fontData from './design-tokens.tokens.json';
import spacingEffectsData from './design-tokens.tokenss.json';

export type ThemeMode = 'light' | 'dark';

export const BrandColors = {
  forestGreen: colorData.brand.forest_green,
  crestYellow: colorData.brand.crest_yellow,
  mandarinOrange: colorData.brand.mandarin_orange,
} as const;

export const LightColors = {
  ...colorData.roles.standard.light,
  success: colorData.roles.standard.light.secondary,
  on_success: colorData.roles.standard.light.on_secondary,
  success_container: colorData.roles.standard.light.secondary_container,
  on_success_container: colorData.roles.standard.light.on_secondary_container,
} as const;

export const DarkColors = {
  ...colorData.roles.standard.dark,
  success: colorData.roles.standard.dark.secondary,
  on_success: colorData.roles.standard.dark.on_secondary,
  success_container: colorData.roles.standard.dark.secondary_container,
  on_success_container: colorData.roles.standard.dark.on_secondary_container,
} as const;

export type ColorTokens = typeof LightColors;

export const StateOpacities = {
  hover: colorData.state.hover,
  focus: colorData.state.focus,
  pressed: colorData.state.pressed,
  dragged: colorData.state.dragged,
  disabledContent: colorData.state.disabled_content,
  disabledContainer: colorData.state.disabled_container,
} as const;

export const Spacing = {
  none: spacingEffectsData.spacing['no spacing'].value, // 0
  xs: spacingEffectsData.spacing['extra small spacing'].value, // 4
  sm: spacingEffectsData.spacing['small spacing'].value, // 8
  md: spacingEffectsData.spacing['medium spacing'].value, // 12
  base: spacingEffectsData.spacing['base spacing'].value, // 16
  lg: spacingEffectsData.spacing['large spacing'].value, // 20
  xl: spacingEffectsData.spacing['extra large spacing'].value, // 24
  xxl: spacingEffectsData.spacing['very large spacing'].value, // 32
} as const;

export const Radius = {
  none: radiusData.radius.none.value, // 0
  sm: radiusData.radius.small.value, // 8
  md: radiusData.radius.medium.value, // 12
  lg: radiusData.radius.large.value, // 16
  xl: radiusData.radius['extra large'].value, // 28
  full: radiusData.radius.full.value, // 9999
} as const;

export const FontFamilies = {
  primary: fontData['font family'].primary.value, // 'Red Hat Display'
  secondary: fontData['font family'].secondary.value, // 'Inter'
} as const;

export const Typography = {
  displayLarge: {
    fontFamily: fontData.typography['display large'].fontFamily.value,
    fontSize: fontData.typography['display large'].fontSize.value,
    lineHeight: fontData.typography['display large'].lineHeight.value,
    fontWeight: String(fontData.typography['display large'].fontWeight.value) as '600',
    letterSpacing: fontData.typography['display large'].letterSpacing.value,
  },
  displayMedium: {
    fontFamily: fontData.typography['display medium'].fontFamily.value,
    fontSize: fontData.typography['display medium'].fontSize.value,
    lineHeight: fontData.typography['display medium'].lineHeight.value,
    fontWeight: String(fontData.typography['display medium'].fontWeight.value) as '500',
    letterSpacing: fontData.typography['display medium'].letterSpacing.value,
  },
  displaySmall: {
    fontFamily: fontData.typography['display small'].fontFamily.value,
    fontSize: fontData.typography['display small'].fontSize.value,
    lineHeight: fontData.typography['display small'].lineHeight.value,
    fontWeight: String(fontData.typography['display small'].fontWeight.value) as '500',
    letterSpacing: fontData.typography['display small'].letterSpacing.value,
  },
  headlineLarge: {
    fontFamily: fontData.typography['headline large'].fontFamily.value,
    fontSize: fontData.typography['headline large'].fontSize.value,
    lineHeight: fontData.typography['headline large'].lineHeight.value,
    fontWeight: String(fontData.typography['headline large'].fontWeight.value) as '500',
    letterSpacing: fontData.typography['headline large'].letterSpacing.value,
  },
  headlineMedium: {
    fontFamily: fontData.typography['headline medium'].fontFamily.value,
    fontSize: fontData.typography['headline medium'].fontSize.value,
    lineHeight: fontData.typography['headline medium'].lineHeight.value,
    fontWeight: String(fontData.typography['headline medium'].fontWeight.value) as '500',
    letterSpacing: fontData.typography['headline medium'].letterSpacing.value,
  },
  headlineSmall: {
    fontFamily: fontData.typography['headline small'].fontFamily.value,
    fontSize: fontData.typography['headline small'].fontSize.value,
    lineHeight: fontData.typography['headline small'].lineHeight.value,
    fontWeight: String(fontData.typography['headline small'].fontWeight.value) as '500',
    letterSpacing: fontData.typography['headline small'].letterSpacing.value,
  },
  titleLarge: {
    fontFamily: fontData.typography['title large'].fontFamily.value,
    fontSize: fontData.typography['title large'].fontSize.value,
    lineHeight: fontData.typography['title large'].lineHeight.value,
    fontWeight: String(fontData.typography['title large'].fontWeight.value) as '500',
    letterSpacing: fontData.typography['title large'].letterSpacing.value,
  },
  titleLargeReduced: {
    fontFamily: fontData.typography['title large reduced'].fontFamily.value,
    fontSize: fontData.typography['title large reduced'].fontSize.value,
    lineHeight: fontData.typography['title large reduced'].lineHeight.value,
    fontWeight: String(fontData.typography['title large reduced'].fontWeight.value) as '500',
    letterSpacing: fontData.typography['title large reduced'].letterSpacing.value,
  },
  titleMediumIncreased: {
    fontFamily: fontData.typography['title medium increased'].fontFamily.value,
    fontSize: fontData.typography['title medium increased'].fontSize.value,
    lineHeight: fontData.typography['title medium increased'].lineHeight.value,
    fontWeight: String(fontData.typography['title medium increased'].fontWeight.value) as '500',
    letterSpacing: fontData.typography['title medium increased'].letterSpacing.value,
  },
  titleMedium: {
    fontFamily: fontData.typography['title medium'].fontFamily.value,
    fontSize: fontData.typography['title medium'].fontSize.value,
    lineHeight: fontData.typography['title medium'].lineHeight.value,
    fontWeight: String(fontData.typography['title medium'].fontWeight.value) as '500',
    letterSpacing: fontData.typography['title medium'].letterSpacing.value,
  },
  titleSmall: {
    fontFamily: fontData.typography['title small'].fontFamily.value,
    fontSize: fontData.typography['title small'].fontSize.value,
    lineHeight: fontData.typography['title small'].lineHeight.value,
    fontWeight: String(fontData.typography['title small'].fontWeight.value) as '600',
    letterSpacing: fontData.typography['title small'].letterSpacing.value,
  },
  bodyLarge: {
    fontFamily: fontData.typography['body large'].fontFamily.value,
    fontSize: fontData.typography['body large'].fontSize.value,
    lineHeight: fontData.typography['body large'].lineHeight.value,
    fontWeight: String(fontData.typography['body large'].fontWeight.value) as '500',
    letterSpacing: fontData.typography['body large'].letterSpacing.value,
  },
  bodyMedium: {
    fontFamily: fontData.typography['body medium'].fontFamily.value,
    fontSize: fontData.typography['body medium'].fontSize.value,
    lineHeight: fontData.typography['body medium'].lineHeight.value,
    fontWeight: String(fontData.typography['body medium'].fontWeight.value) as '500',
    letterSpacing: fontData.typography['body medium'].letterSpacing.value,
  },
  bodySmall: {
    fontFamily: fontData.typography['body small'].fontFamily.value,
    fontSize: fontData.typography['body small'].fontSize.value,
    lineHeight: fontData.typography['body small'].lineHeight.value,
    fontWeight: String(fontData.typography['body small'].fontWeight.value) as '500',
    letterSpacing: fontData.typography['body small'].letterSpacing.value,
  },
  labelLarge: {
    fontFamily: fontData.typography['label large'].fontFamily.value,
    fontSize: fontData.typography['label large'].fontSize.value,
    lineHeight: fontData.typography['label large'].lineHeight.value,
    fontWeight: String(fontData.typography['label large'].fontWeight.value) as '500',
    letterSpacing: fontData.typography['label large'].letterSpacing.value,
  },
  labelMedium: {
    fontFamily: fontData.typography['label medium'].fontFamily.value,
    fontSize: fontData.typography['label medium'].fontSize.value,
    lineHeight: fontData.typography['label medium'].lineHeight.value,
    fontWeight: String(fontData.typography['label medium'].fontWeight.value) as '500',
    letterSpacing: fontData.typography['label medium'].letterSpacing.value,
  },
  labelSmall: {
    fontFamily: fontData.typography['label small'].fontFamily.value,
    fontSize: fontData.typography['label small'].fontSize.value,
    lineHeight: fontData.typography['label small'].lineHeight.value,
    fontWeight: String(fontData.typography['label small'].fontWeight.value) as '500',
    letterSpacing: fontData.typography['label small'].letterSpacing.value,
  },
} as const;

export const Shadows = {
  hard: {
    shadowColor: '#002868',
    shadowOffset: {
      width: spacingEffectsData.effect['hard shadow'].value.offsetX,
      height: spacingEffectsData.effect['hard shadow'].value.offsetY,
    },
    shadowOpacity: 0.27, // 0x45 / 255
    shadowRadius: spacingEffectsData.effect['hard shadow'].value.radius,
    elevation: 8,
  },
  medium: {
    shadowColor: '#002868',
    shadowOffset: {
      width: spacingEffectsData.effect.medium.value.offsetX,
      height: spacingEffectsData.effect.medium.value.offsetY,
    },
    shadowOpacity: 0.28, // 0x47 / 255
    shadowRadius: spacingEffectsData.effect.medium.value.radius,
    elevation: 4,
  },
  soft: {
    shadowColor: '#002868',
    shadowOffset: {
      width: spacingEffectsData.effect.soft.value.offsetX,
      height: spacingEffectsData.effect.soft.value.offsetY,
    },
    shadowOpacity: 0.12, // 0x1f / 255
    shadowRadius: spacingEffectsData.effect.soft.value.radius,
    elevation: 2,
  },
} as const;

export const getThemeColors = (mode: ThemeMode): ColorTokens => {
  return mode === 'dark' ? DarkColors : LightColors;
};

