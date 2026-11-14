import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';

export interface ScreenShellProps {
  children: React.ReactNode;
  title?: string;
  onBack?: () => void;
  scrollable?: boolean;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  headerRight?: React.ReactNode;
  titleAlign?: 'center' | 'left';
  headerInset?: number;
}

export const ScreenShell: React.FC<ScreenShellProps> = ({
  children,
  title,
  onBack,
  scrollable = true,
  contentContainerStyle,
  style,
  headerRight,
  titleAlign = 'center',
  headerInset,
}) => {
  const { colors, spacing, typography, mode } = useTheme();

  const effectiveHeaderInset = headerInset !== undefined ? headerInset : spacing.base;

  const renderHeader = () => {
    if (!title && !onBack && !headerRight) {
      return null;
    }

    return (
      <View
        style={[
          styles.headerRow,
          {
            paddingLeft: effectiveHeaderInset,
            paddingRight: effectiveHeaderInset,
            paddingVertical: spacing.sm,
            minHeight: 48,
          },
        ]}
      >
        <View
          style={[
            styles.headerLeft,
            titleAlign === 'left' && [
              styles.headerLeftAlignLeft,
              { marginRight: spacing.base },
            ],
          ]}
        >
          {onBack && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={STRINGS.common.back}
              accessibilityHint="Navigates back to the previous screen"
              onPress={onBack}
              style={[
                styles.backButton,
                {
                  minWidth: 44,
                  minHeight: 44,
                  paddingRight: spacing.sm,
                },
              ]}
            >
              <Text
                allowFontScaling
                style={[
                  styles.backButtonText,
                  {
                    color: colors.primary_text,
                    fontFamily: typography.labelLarge.fontFamily,
                    fontSize: typography.labelLarge.fontSize,
                  },
                ]}
              >
                ← {STRINGS.common.back}
              </Text>
            </Pressable>
          )}
          {titleAlign === 'left' && title ? (
            <Text
              allowFontScaling
              accessibilityRole="header"
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[
                styles.headerTitleLeft,
                {
                  color: colors.on_surface,
                  fontFamily: typography.titleLargeReduced.fontFamily,
                  fontSize: typography.titleLargeReduced.fontSize,
                  fontWeight: typography.titleLargeReduced.fontWeight,
                },
              ]}
            >
              {title}
            </Text>
          ) : null}
        </View>

        {titleAlign === 'center' ? (
          <View style={styles.headerCenter}>
            {title ? (
              <Text
                allowFontScaling
                accessibilityRole="header"
                numberOfLines={1}
                style={[
                  styles.headerTitle,
                  {
                    color: colors.on_surface,
                    fontFamily: typography.titleMedium.fontFamily,
                    fontSize: typography.titleMedium.fontSize,
                    fontWeight: typography.titleMedium.fontWeight,
                  },
                ]}
              >
                {title}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View
          style={[
            styles.headerRight,
            titleAlign === 'left' && styles.headerRightAlignLeft,
          ]}
        >
          {headerRight}
        </View>
      </View>
    );
  };

  const ContentWrapper = scrollable ? ScrollView : View;
  const contentProps = scrollable
    ? {
      contentContainerStyle: [
        styles.scrollContent,
        {
          padding: spacing.base,
        },
        contentContainerStyle,
      ],
      keyboardShouldPersistTaps: 'handled' as const,
    }
    : {
      style: [
        styles.fixedContent,
        {
          padding: spacing.base,
        },
        contentContainerStyle,
      ],
    };

  return (
    <SafeAreaView
      style={[
        styles.safeArea,
        {
          backgroundColor: colors.surface,
        },
        style,
      ]}
    >
      <StatusBar
        barStyle={mode === 'dark' ? 'light-content' : 'dark-content'}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardContainer}
      >
        {renderHeader()}
        <ContentWrapper {...contentProps}>{children}</ContentWrapper>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  keyboardContainer: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  headerLeft: {
    minWidth: 80,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerLeftAlignLeft: {
    flex: 1,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    minWidth: 0,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRight: {
    minWidth: 80,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  headerRightAlignLeft: {
    minWidth: 0,
    flexShrink: 0,
  },
  backButton: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  backButtonText: {
    fontWeight: '600',
  },
  headerTitle: {
    textAlign: 'center',
  },
  headerTitleLeft: {
    textAlign: 'left',
    flexShrink: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  fixedContent: {
    flex: 1,
  },
});

