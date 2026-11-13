import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';

export interface FormErrorProps {
  message?: string | null;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export const FormError: React.FC<FormErrorProps> = ({ message, style, testID }) => {
  const { colors, spacing, radius, typography } = useTheme();

  if (!message) {
    return null;
  }

  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${STRINGS.accessibility.formErrorPrefix}${message}`}
      style={[
        styles.container,
        {
          backgroundColor: colors.error_container,
          borderColor: colors.error,
          borderWidth: 1,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          marginBottom: spacing.md,
        },
        style,
      ]}
    >
      <Text
        allowFontScaling
        style={[
          styles.text,
          {
            color: colors.on_error_container,
            fontFamily: typography.bodyMedium.fontFamily,
            fontSize: typography.bodyMedium.fontSize,
            lineHeight: typography.bodyMedium.lineHeight,
          },
        ]}
      >
        {message}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  text: {
    flex: 1,
    letterSpacing: -0.1,
  },
});

