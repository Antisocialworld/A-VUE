import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { ClapperMark } from './ClapperMark';

export interface LogoProps {
  size?: number;
  theme?: 'light' | 'dark';
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A VUE Logo Component
 * Unified brand logo: replaces old raster lockups with ClapperMark across all screens.
 * Keeps LogoProps backwards-compatible for existing callers.
 * Design (agreed):
 * - Name sits inside clapperboard in dark panel
 * - Same look on every screen (tokens used directly, does not switch with theme)
 */
export const Logo: React.FC<LogoProps> = ({
  size = 140,
  accessibilityLabel,
  style,
}) => {
  return (
    <ClapperMark
      size={size}
      accessibilityLabel={accessibilityLabel}
      style={style}
    />
  );
};
