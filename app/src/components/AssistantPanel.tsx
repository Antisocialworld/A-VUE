import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';
import { AssistantChat } from './AssistantChat';
import { ASSISTANT_PANEL_WIDTH } from '../utils/assistantLayout';

export interface AssistantPanelProps {
  onClose: () => void;
  onSessionExpired: () => void;
}

/** Wide-web overlay: a right-side panel with the page still visible behind it. */
export const AssistantPanel: React.FC<AssistantPanelProps> = ({ onClose, onSessionExpired }) => {
  const { colors, spacing, typography, radius, shadows } = useTheme();

  return (
    <View style={styles.overlay}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={STRINGS.common.close}
        onPress={onClose}
        style={[styles.backdrop, { backgroundColor: colors.scrim, opacity: 0.4 }]}
      />

      <View
        style={[
          styles.panel,
          shadows.medium,
          {
            width: ASSISTANT_PANEL_WIDTH,
            maxWidth: '100%',
            backgroundColor: colors.surface,
            borderLeftColor: colors.outline_variant,
          },
        ]}
      >
        <View
          style={[
            styles.header,
            {
              borderBottomColor: colors.outline_variant,
              gap: spacing.sm,
              paddingHorizontal: spacing.base,
              paddingVertical: spacing.sm,
            },
          ]}
        >
          <Text
            allowFontScaling
            accessibilityRole="header"
            style={{
              color: colors.on_surface,
              fontFamily: typography.titleMedium.fontFamily,
              fontSize: typography.titleMedium.fontSize,
              fontWeight: typography.titleMedium.fontWeight,
              flexShrink: 1,
            }}
          >
            {STRINGS.assistant.title}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={STRINGS.common.close}
            onPress={onClose}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            style={[
              styles.closeButton,
              {
                borderRadius: radius.full,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                backgroundColor: colors.surface_container_high,
              },
            ]}
          >
            <Text
              allowFontScaling
              style={{
                color: colors.on_surface,
                fontFamily: typography.labelMedium.fontFamily,
                fontSize: typography.labelMedium.fontSize,
              }}
            >
              {STRINGS.common.close}
            </Text>
          </Pressable>
        </View>

        <AssistantChat onSessionExpired={onSessionExpired} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 100,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  panel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    borderLeftWidth: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
  },
  closeButton: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
