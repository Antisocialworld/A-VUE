import React, { useImperativeHandle, useRef, useState } from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';
import { useAutoFocus } from '../hooks/useAutoFocus';

export interface CodeInputRef {
  focus: () => void;
  blur: () => void;
}

export interface CodeInputProps {
  value: string;
  onChangeText: (code: string) => void;
  length?: number;
  autoFocus?: boolean;
  error?: string;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const CodeInput = React.forwardRef<CodeInputRef, CodeInputProps>(
  (
    {
      value,
      onChangeText,
      length = 6,
      autoFocus = false,
      error,
      disabled = false,
      accessibilityLabel = STRINGS.verifyCode.codeLabel,
      testID,
      style,
    },
    ref,
  ) => {
    const { colors, spacing, radius, typography } = useTheme();
    const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
    const [isFocused, setIsFocused] = useState(false);

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
      blur: () => inputRef.current?.blur(),
    }));

    // Auto-focus after screen transition finishes via shared useAutoFocus hook (Task 1)
    useAutoFocus(inputRef, autoFocus && !disabled);

    const cleanValue = value.replace(/[^0-9]/g, '').slice(0, length);

    const handleCellPress = () => {
      if (!disabled) {
        inputRef.current?.focus();
      }
    };

    const handleTextChange = (text: string) => {
      const digitsOnly = text.replace(/[^0-9]/g, '').slice(0, length);
      onChangeText(digitsOnly);
    };

    const cells = Array.from({ length }, (_, index) => {
      const digit = cleanValue[index] || '';
      const isCurrent = isFocused && index === cleanValue.length;
      const isLastAndFilled = isFocused && cleanValue.length === length && index === length - 1;
      const isActive = isCurrent || isLastAndFilled;

      let borderColor = colors.outline_variant;
      let backgroundColor = colors.surface_container_lowest;

      if (disabled) {
        borderColor = colors.surface_container_highest;
        backgroundColor = colors.surface_container_low;
      } else if (error) {
        borderColor = colors.error;
      } else if (isActive) {
        borderColor = colors.primary;
      }

      return (
        <View
          key={index}
          accessibilityRole="text"
          accessibilityLabel={STRINGS.verifyCode.codeCellAccessibilityLabel(index, digit)}
          style={[
            styles.cell,
            {
              minWidth: 44, // Touch target >= 44
              minHeight: 52,
              borderColor,
              backgroundColor,
              borderWidth: isActive || error ? 2 : 1,
              borderRadius: radius.md,
              marginHorizontal: spacing.xs,
            },
          ]}
        >
          <Text
            allowFontScaling
            style={[
              styles.cellText,
              {
                color: disabled ? colors.outline : colors.on_surface,
                fontFamily: typography.headlineMedium.fontFamily,
                fontSize: typography.headlineMedium.fontSize,
                fontWeight: typography.headlineMedium.fontWeight,
              },
            ]}
          >
            {digit}
          </Text>
        </View>
      );
    });

    return (
      <View style={[styles.container, style]}>
        {/* Task 6: Drop container accessibilityLabel so TalkBack / VoiceOver navigate per-cell labels */}
        <Pressable
          testID={testID}
          onPress={handleCellPress}
          accessible={false}
          accessibilityState={{ disabled }}
          style={styles.cellRow}
        >
          {cells}
        </Pressable>

        {/* Hidden input for real keyboard handling (Documented Exemption) */}
        <TextInput
          ref={inputRef}
          value={cleanValue}
          onChangeText={handleTextChange}
          keyboardType="number-pad"
          maxLength={length}
          editable={!disabled}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          accessibilityLabel={accessibilityLabel}
          style={styles.hiddenInput}
          caretHidden
          accessibilityElementsHidden
          importantForAccessibility="no"
        />

        {error ? (
          <Text
            allowFontScaling
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={[
              styles.errorText,
              {
                color: colors.error,
                marginTop: spacing.xs,
                fontFamily: typography.bodySmall.fontFamily,
                fontSize: typography.bodySmall.fontSize,
                lineHeight: typography.bodySmall.lineHeight,
              },
            ]}
          >
            {error}
          </Text>
        ) : null}
      </View>
    );
  },
);

CodeInput.displayName = 'CodeInput';

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
  },
  cellRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  cell: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  cellText: {
    textAlign: 'center',
  },
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    width: 1,
    height: 1,
  },
  errorText: {
    textAlign: 'center',
    letterSpacing: -0.08,
  },
});
