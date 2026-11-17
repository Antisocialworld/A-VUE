import React from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useTheme } from '../context/ThemeContext';

export interface SearchIconProps {
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * A VUE SearchIcon Component
 * Vector magnifying glass icon drawn with react-native-svg using design token colours.
 */
export const SearchIcon: React.FC<SearchIconProps> = ({
  size = 18,
  color,
  style,
  accessibilityLabel,
  testID,
}) => {
  const { colors } = useTheme();
  const strokeColor = color || colors.on_surface_variant;

  return (
    <View
      style={[{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }, style]}
      accessible={false}
      testID={testID}
    >
      <Svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        accessibilityLabel={accessibilityLabel}
      >
        <Circle
          cx="11"
          cy="11"
          r="7"
          stroke={strokeColor}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          d="M 16.5 16.5 L 21 21"
          stroke={strokeColor}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
};
