import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { TextField, TextFieldProps } from './TextField';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';
import { checkPasswordRequirements } from '../schemas/auth';
import { useAutoFocus } from '../hooks/useAutoFocus';

export interface PasswordFieldProps extends Omit<TextFieldProps, 'secureTextEntry' | 'rightAccessory'> {
  showChecklist?: boolean;
}

export const PasswordField = React.forwardRef<React.ComponentRef<typeof TextInput>, PasswordFieldProps>(
  (
    {
      value,
      onChangeText,
      label = STRINGS.signIn.passwordLabel,
      placeholder = STRINGS.signIn.passwordPlaceholder,
      showChecklist = false,
      error,
      disabled,
      autoFocus = false,
      style,
      ...rest
    },
    ref,
  ) => {
    const { colors, spacing, typography } = useTheme();
    const [isPasswordVisible, setIsPasswordVisible] = useState(false);
    const [liveAnnouncement, setLiveAnnouncement] = useState('');
    const internalInputRef = useRef<React.ComponentRef<typeof TextInput>>(null);

    useImperativeHandle(ref, () => internalInputRef.current!);

    // Auto-focus after screen transition finishes via shared useAutoFocus hook (Task 1)
    useAutoFocus(internalInputRef, autoFocus && !disabled);

    const toggleVisibility = () => {
      setIsPasswordVisible((prev) => !prev);
    };

    // Live password criteria evaluation on every keystroke
    const requirements = checkPasswordRequirements(value || '');

    const checklistItems = [
      { key: 'minLength', label: STRINGS.checklist.minLength, satisfied: requirements.minLength },
      { key: 'uppercase', label: STRINGS.checklist.uppercase, satisfied: requirements.hasUppercase },
      { key: 'lowercase', label: STRINGS.checklist.lowercase, satisfied: requirements.hasLowercase },
      {
        key: 'digitOrSymbol',
        label: STRINGS.checklist.digitOrSymbol,
        satisfied: requirements.hasDigitOrSymbol,
      },
    ];

    // Track previous status to announce ONLY when status changes
    const prevStatusRef = useRef<Record<string, boolean>>({
      minLength: false,
      uppercase: false,
      lowercase: false,
      digitOrSymbol: false,
    });

    useEffect(() => {
      if (!showChecklist) return;

      const changedAnnouncements: string[] = [];
      checklistItems.forEach((item) => {
        const wasSatisfied = prevStatusRef.current[item.key];
        if (wasSatisfied !== item.satisfied) {
          const statusText = item.satisfied
            ? STRINGS.checklist.accessibleValid
            : STRINGS.checklist.accessibleInvalid;
          const announcement = `${item.label}, ${statusText}`;
          changedAnnouncements.push(announcement);
          prevStatusRef.current[item.key] = item.satisfied;
        }
      });

      if (changedAnnouncements.length > 0) {
        // Announce ONE combined message when multiple rows change in one keystroke (Task 6)
        const fullAnnouncement = changedAnnouncements.join('. ');
        AccessibilityInfo.announceForAccessibility(fullAnnouncement);
        if (Platform.OS === 'android') {
          setLiveAnnouncement(fullAnnouncement);
        }
      }
    }, [requirements.minLength, requirements.hasUppercase, requirements.hasLowercase, requirements.hasDigitOrSymbol, showChecklist]);

    const eyeToggleLabel = isPasswordVisible
      ? STRINGS.accessibility.hidePassword
      : STRINGS.accessibility.showPassword;

    const eyeAccessory = (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={eyeToggleLabel}
        accessibilityHint="Toggles password visibility between plain text and masked dots"
        onPress={toggleVisibility}
        disabled={disabled}
        style={[
          styles.eyeButton,
          {
            minWidth: 44, // Touch target >= 44
            minHeight: 44,
            paddingHorizontal: spacing.xs,
          },
        ]}
      >
        <Text
          allowFontScaling
          style={[
            styles.eyeIconText,
            {
              color: isPasswordVisible ? colors.primary : colors.outline,
              fontFamily: typography.labelMedium.fontFamily,
              fontSize: typography.labelMedium.fontSize,
            },
          ]}
        >
          {isPasswordVisible ? 'HIDE' : 'SHOW'}
        </Text>
      </Pressable>
    );

    return (
      <View style={[styles.container, style]}>
        <TextField
          ref={internalInputRef}
          label={label}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          secureTextEntry={!isPasswordVisible}
          rightAccessory={eyeAccessory}
          error={error}
          disabled={disabled}
          autoFocus={false} // Handled directly by PasswordField's useAutoFocus
          autoCapitalize="none"
          {...rest}
        />

        {/* Android extra live region */}
        {showChecklist && liveAnnouncement ? (
          <Text
            accessibilityLiveRegion="polite"
            style={styles.srOnly}
          >
            {liveAnnouncement}
          </Text>
        ) : null}

        {showChecklist && (
          <View
            accessibilityRole="none"
            accessibilityLabel={STRINGS.checklist.title}
            style={[
              styles.checklistContainer,
              {
                marginTop: -spacing.xs,
                marginBottom: spacing.md,
                paddingLeft: spacing.xs,
              },
            ]}
          >
            <Text
              allowFontScaling
              style={[
                styles.checklistTitle,
                {
                  color: colors.on_surface_variant,
                  marginBottom: spacing.xs,
                  fontFamily: typography.bodySmall.fontFamily,
                  fontSize: typography.bodySmall.fontSize,
                  fontWeight: typography.bodySmall.fontWeight,
                  lineHeight: typography.bodySmall.lineHeight,
                },
              ]}
            >
              {STRINGS.checklist.title}
            </Text>

            {checklistItems.map((item) => {
              const itemColor = item.satisfied ? colors.success : colors.outline;
              const statusText = item.satisfied ? 'met' : 'not met';

              return (
                <View
                  key={item.key}
                  accessibilityRole="text"
                  accessibilityLabel={`${item.label}, ${statusText}`}
                  style={[styles.checklistItem, { marginVertical: 2 }]}
                >
                  <Text
                    allowFontScaling
                    style={[
                      styles.checkMark,
                      {
                        color: itemColor,
                        marginRight: spacing.xs,
                        fontFamily: typography.bodySmall.fontFamily,
                        fontSize: typography.bodySmall.fontSize,
                        fontWeight: item.satisfied ? '600' : '400',
                      },
                    ]}
                  >
                    {item.satisfied ? '✓' : '•'}
                  </Text>
                  <Text
                    allowFontScaling
                    style={[
                      styles.itemLabel,
                      {
                        color: itemColor,
                        fontFamily: typography.bodySmall.fontFamily,
                        fontSize: typography.bodySmall.fontSize,
                        lineHeight: typography.bodySmall.lineHeight,
                      },
                    ]}
                  >
                    {item.label}
                  </Text>
                </View>
              );
            })}
          </View>
        )}
      </View>
    );
  },
);

PasswordField.displayName = 'PasswordField';

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  eyeButton: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  eyeIconText: {
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  checklistContainer: {
    width: '100%',
  },
  checklistTitle: {
    letterSpacing: -0.08,
  },
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkMark: {
    width: 14,
    textAlign: 'center',
  },
  itemLabel: {
    letterSpacing: -0.08,
  },
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    opacity: 0,
  },
});
