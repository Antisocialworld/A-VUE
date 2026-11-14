import React from 'react';
import { View, ViewStyle, StyleProp } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';
import { STRINGS } from '../constants/strings';
import { useTheme } from '../context/ThemeContext';
import colorData from '../tokens/color-tokens-orange-green-yellow.json';

/**
 * Shared letterform path definitions for "A VUE"
 * Agreed A1 chevron lettering (filled, not stroked).
 * Used by WordmarkName, ClapperMark, and WelcomeHero — single source of truth, no duplicate paths.
 */
export const WORDMARK_PATHS = [
  { id: 'A', d: 'M0 109 L85 2 H117 L202 109 H159 L101 34 L43 109 Z' },
  { id: 'V', d: 'M219 1.5 H249.5 L290.5 79 L331.5 1.5 H362 L304.5 109 H276.5 Z' },
  { id: 'U', d: 'M371 1.5 H397 V75 Q397 89 411 89 H439 Q453 89 453 75 V1.5 H479 V80 Q479 109 450 109 H400 Q371 109 371 80 Z' },
  { id: 'E', d: 'M493 1.5 H574 L578 20.5 H518 V43 H545 V61 H518 V89 H578 L574 109 H493 Z' },
];

export const WORDMARK_BOX = { w: 578, h: 111, top: 1.5, bottom: 109 };

export interface WordmarkNameProps {
  width?: number;
  color?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * WordmarkName Component
 * Renders the filled "A VUE" wordmark letter paths.
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

  const aspectRatio = 578 / 111;
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
        viewBox="0 0 578 111"
        fill="none"
        accessible={false}
      >
        <G fill={activeColor}>
          {WORDMARK_PATHS.map((item) => (
            <Path
              key={item.id}
              d={item.d}
              fill={activeColor}
            />
          ))}
        </G>
      </Svg>
    </View>
  );
};

