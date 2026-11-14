import React from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../context/ThemeContext';

export interface TicketIconProps {
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * A VUE TicketIcon Component
 * Vector icon representing a cinema admission ticket:
 * - Ticket outline with side notches
 * - Dashed internal ticket divider
 * Drawn with react-native-svg using design token colours.
 */
export const TicketIcon: React.FC<TicketIconProps> = ({
  size = 18,
  color,
  style,
  accessibilityLabel,
  testID,
}) => {
  const { colors } = useTheme();
  const strokeColor = color || colors.on_primary;

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
        {/* Ticket outer path with curved corners and left/right notches */}
        <Path
          d="M 4 5 H 20 A 2 2 0 0 1 22 7 V 9.5 A 2.5 2.5 0 0 0 22 14.5 V 17 A 2 2 0 0 1 20 19 H 4 A 2 2 0 0 1 2 17 V 14.5 A 2.5 2.5 0 0 0 2 9.5 V 7 A 2 2 0 0 1 4 5 Z"
          stroke={strokeColor}
          strokeWidth={1.75}
          fill="none"
          strokeLinejoin="round"
        />
        {/* Dashed vertical ticket divider */}
        <Path
          d="M 9 6.5 V 17.5"
          stroke={strokeColor}
          strokeWidth={1.5}
          strokeDasharray="2 2"
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
};

