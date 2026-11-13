import React from 'react';
import { View, ViewStyle, StyleProp } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';
import { STRINGS } from '../constants/strings';
import { useTheme } from '../context/ThemeContext';
import colorData from '../tokens/color-tokens-orange-green-yellow.json';

/**
 * Shared letterform path definitions for "A VUE"
 * Extracted verbatim from a-vue-motion-long-5.5s.html / a-vue-logo-lockup-dark.svg.
 * Used by WordmarkName and ClapperMark — single source of truth, no duplicate paths.
 */
export const WORDMARK_PATHS = [
  { id: 'A', d: 'M0 40 L14 0 L28 40 M5 26 L23 26' },
  { id: 'V', d: 'M0 0 L14 40 L28 0', transform: 'translate(60,0)' },
  { id: 'U', d: 'M0 0 V26 A14 14 0 0 0 28 26 V0', transform: 'translate(100,0)' },
  { id: 'E', d: 'M28 0 H0 V40 H28 M0 20 H22', transform: 'translate(140,0)' },
];

export interface WordmarkNameProps {
  width?: number;
  color?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * WordmarkName Component
 * Renders the stroked "A VUE" wordmark letter paths.
 */
export const WordmarkName: React.FC<WordmarkNameProps> = ({
  width = 168,
  color,
  accessibilityLabel,
  style,
}) => {
  const { mode } = useTheme();
  // Name colour: dark theme = primary 80 (#FFCEBE). Light theme = primary 40 (#FD550A)
  const defaultColor =
    mode === 'dark' ? colorData.palettes.primary['80'] : colorData.palettes.primary['40'];
  const activeColor = color || defaultColor;

  const aspectRatio = 168 / 40;
  const height = width / aspectRatio;

  return (
    <View
      accessibilityRole="header"
      accessibilityLabel={accessibilityLabel || STRINGS.appName}
      style={style}
    >
      <Svg
        width={width}
        height={height}
        viewBox="-4 -4 176 48"
        fill="none"
        accessible={false}
      >
        <G
          stroke={activeColor}
          strokeWidth={6}
          strokeLinecap="butt"
          strokeLinejoin="miter"
          strokeMiterlimit={1.5}
        >
          {WORDMARK_PATHS.map((item) => (
            <Path
              key={item.id}
              d={item.d}
              transform={item.transform}
            />
          ))}
        </G>
      </Svg>
    </View>
  );
};

