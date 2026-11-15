import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';
import { TextField } from './TextField';
import { PasswordField } from './PasswordField';
import { Button } from './Button';
import { authClient } from '../api/authClient';

export interface AccountMenuProps {
  onSignOut: () => void;
  testID?: string;
}

/**
 * A VUE AccountMenu Component
 * Header action providing account options:
 * - 36pt circular button with 44pt tap target (hitSlop)
 * - Popover menu with "Sign out" and danger "Delete account"
 * - 2-step delete account flow with "DELETE" confirmation and 30-day grace period notice
 * Colors from tokens only. Strings from constants/strings.ts.
 */
export const AccountMenu: React.FC<AccountMenuProps> = ({
  onSignOut,
  testID,
}) => {
  const { colors, spacing, radius, typography, shadows } = useTheme();

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteStep, setDeleteStep] = useState<1 | 2>(1);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const openMenu = () => {
    setIsMenuOpen(true);
  };

  const closeMenu = () => {
    setIsMenuOpen(false);
  };

  const handleStartDelete = () => {
    closeMenu();
    setDeleteStep(1);
    setDeleteConfirmText('');
    setPassword('');
    setErrorMessage(null);
    setSuccessNotice(null);
    setIsDeleteModalOpen(true);
  };

  const closeDeleteModal = () => {
    if (loading) return;
    setIsDeleteModalOpen(false);
    setDeleteStep(1);
    setDeleteConfirmText('');
    setPassword('');
    setErrorMessage(null);
    setSuccessNotice(null);
  };

  const handleDeleteSubmit = async () => {
    if (!password || loading) return;

    setLoading(true);
    setErrorMessage(null);

    try {
      await authClient.deleteAccount(password);
      setSuccessNotice(STRINGS.account.deleteSuccessMessage);
    } catch (err: any) {
      if (err?.code === 'HAS_UPCOMING_TICKETS' || err?.message?.includes('upcoming tickets')) {
        setErrorMessage(STRINGS.account.hasUpcomingTicketsError);
      } else {
        setErrorMessage(err?.message || STRINGS.common.genericError);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleFinalSuccessSignOut = () => {
    setIsDeleteModalOpen(false);
    onSignOut();
  };

  return (
    <View style={styles.container} testID={testID}>
      {/* 36pt visual circle button with 44pt effective tap target */}
      <Pressable
        onPress={openMenu}
        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        accessibilityRole="button"
        accessibilityLabel={STRINGS.account.menuAccessibilityLabel}
        accessibilityHint={STRINGS.account.menuAccessibilityHint}
        style={({ pressed }) => [
          styles.menuButton,
          {
            backgroundColor: colors.surface_container_high,
            borderColor: colors.outline_variant,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <Circle
            cx="12"
            cy="8"
            r="4"
            stroke={colors.on_surface_variant}
            strokeWidth={1.75}
            fill="none"
          />
          <Path
            d="M 4 20 C 4 16 8 14 12 14 C 16 14 20 16 20 20"
            stroke={colors.on_surface_variant}
            strokeWidth={1.75}
            strokeLinecap="round"
            fill="none"
          />
        </Svg>
      </Pressable>

      {/* Popover Menu Modal */}
      <Modal
        visible={isMenuOpen}
        transparent={true}
        animationType="fade"
        onRequestClose={closeMenu}
      >
        <Pressable
          style={styles.backdrop}
          onPress={closeMenu}
          accessibilityRole="button"
          accessibilityLabel={STRINGS.account.deleteCancelAction}
        >
          <View
            style={[
              styles.popoverCard,
              shadows.medium,
              {
                backgroundColor: colors.surface_container_high,
                borderColor: colors.outline_variant,
                borderRadius: radius.md,
                padding: spacing.xs,
              },
            ]}
          >
            {/* Sign Out Item */}
            <Pressable
              onPress={() => {
                closeMenu();
                onSignOut();
              }}
              accessibilityRole="button"
              accessibilityLabel={STRINGS.account.signOutAction}
              style={({ pressed }) => [
                styles.popoverItem,
                {
                  borderRadius: radius.sm,
                  paddingVertical: spacing.sm,
                  paddingHorizontal: spacing.md,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text
                style={[
                  typography.bodyMedium,
                  { color: colors.on_surface },
                ]}
              >
                {STRINGS.account.signOutAction}
              </Text>
            </Pressable>

            {/* Delete Account Item (Danger) */}
            <Pressable
              onPress={handleStartDelete}
              accessibilityRole="button"
              accessibilityLabel={STRINGS.account.deleteAccountAction}
              style={({ pressed }) => [
                styles.popoverItem,
                {
                  borderRadius: radius.sm,
                  paddingVertical: spacing.sm,
                  paddingHorizontal: spacing.md,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text
                style={[
                  typography.bodyMedium,
                  { color: colors.error, fontWeight: '600' },
                ]}
              >
                {STRINGS.account.deleteAccountAction}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Delete Account Modal Flow */}
      <Modal
        visible={isDeleteModalOpen}
        transparent={true}
        animationType="fade"
        onRequestClose={closeDeleteModal}
      >
        <View style={[styles.modalBackdrop, { backgroundColor: colors.scrim + '99' }]}>
          <View
            style={[
              styles.deleteDialogCard,
              shadows.medium,
              {
                backgroundColor: colors.surface_container,
                borderRadius: radius.lg,
                padding: spacing.lg,
                borderColor: colors.outline_variant,
              },
            ]}
          >
            {successNotice ? (
              /* Success Notice after scheduling deletion */
              <View style={styles.dialogContent}>
                <Text
                  style={[
                    typography.titleMedium,
                    { color: colors.on_surface, marginBottom: spacing.sm },
                  ]}
                  accessibilityRole="header"
                >
                  {STRINGS.account.deleteSuccessTitle}
                </Text>
                <Text
                  style={[
                    typography.bodyMedium,
                    { color: colors.on_surface_variant, marginBottom: spacing.lg },
                  ]}
                >
                  {successNotice}
                </Text>
                <Button
                  title={STRINGS.account.deleteSuccessAction}
                  onPress={handleFinalSuccessSignOut}
                  variant="primary"
                  accessibilityLabel={STRINGS.account.deleteSuccessAction}
                />
              </View>
            ) : deleteStep === 1 ? (
              /* Step 1: Type DELETE confirmation */
              <View style={styles.dialogContent}>
                <Text
                  style={[
                    typography.titleMedium,
                    { color: colors.error, marginBottom: spacing.xs, fontWeight: '700' },
                  ]}
                  accessibilityRole="header"
                >
                  {STRINGS.account.deleteConfirmTitle}
                </Text>
                <Text
                  style={[
                    typography.bodyMedium,
                    { color: colors.on_surface, marginBottom: spacing.md },
                  ]}
                >
                  {STRINGS.account.deleteStep1Prompt}
                </Text>

                <TextField
                  value={deleteConfirmText}
                  onChangeText={setDeleteConfirmText}
                  placeholder={STRINGS.account.deleteStep1Placeholder}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  label={STRINGS.account.deleteConfirmTitle}
                />

                <View style={[styles.buttonRow, { marginTop: spacing.lg }]}>
                  <View style={styles.buttonHalf}>
                    <Button
                      title={STRINGS.account.deleteCancelAction}
                      onPress={closeDeleteModal}
                      variant="outlined"
                      accessibilityLabel={STRINGS.account.deleteCancelAction}
                    />
                  </View>
                  <View style={styles.buttonHalf}>
                    <Button
                      title={STRINGS.account.deleteNextAction}
                      onPress={() => setDeleteStep(2)}
                      variant="primary"
                      disabled={deleteConfirmText.trim() !== 'DELETE'}
                      accessibilityLabel={STRINGS.account.deleteNextAction}
                    />
                  </View>
                </View>
              </View>
            ) : (
              /* Step 2: Password input + 14-day Grace Period Notice */
              <View style={styles.dialogContent}>
                <Text
                  style={[
                    typography.titleMedium,
                    { color: colors.error, marginBottom: spacing.xs, fontWeight: '700' },
                  ]}
                  accessibilityRole="header"
                >
                  {STRINGS.account.deleteConfirmTitle}
                </Text>
                <Text
                  style={[
                    typography.bodyMedium,
                    { color: colors.on_surface, marginBottom: spacing.md },
                  ]}
                >
                  {STRINGS.account.deleteStep2Prompt}
                </Text>

                <PasswordField
                  value={password}
                  onChangeText={setPassword}
                  label={STRINGS.signIn.passwordLabel}
                  placeholder={STRINGS.signIn.passwordPlaceholder}
                  disabled={loading}
                />

                {/* 30-day grace notice clearly stated BEFORE final button */}
                <View
                  style={[
                    styles.graceNoticeBox,
                    {
                      backgroundColor: colors.surface_container_low,
                      borderRadius: radius.sm,
                      padding: spacing.sm,
                      marginTop: spacing.md,
                      borderColor: colors.outline_variant,
                      borderWidth: 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      typography.bodySmall,
                      { color: colors.on_surface_variant },
                    ]}
                  >
                    {STRINGS.account.deleteGracePeriodNotice}
                  </Text>
                </View>

                {errorMessage ? (
                  <Text
                    style={[
                      typography.bodySmall,
                      { color: colors.error, marginTop: spacing.sm, fontWeight: '600' },
                    ]}
                    accessibilityRole="alert"
                  >
                    {errorMessage}
                  </Text>
                ) : null}

                <View style={[styles.buttonRow, { marginTop: spacing.lg }]}>
                  <View style={styles.buttonHalf}>
                    <Button
                      title={STRINGS.account.deleteCancelAction}
                      onPress={closeDeleteModal}
                      variant="outlined"
                      disabled={loading}
                      accessibilityLabel={STRINGS.account.deleteCancelAction}
                    />
                  </View>
                  <View style={styles.buttonHalf}>
                    <Button
                      title={STRINGS.account.deleteSubmitAction}
                      onPress={handleDeleteSubmit}
                      variant="primary"
                      disabled={!password || loading}
                      loading={loading}
                      style={{ backgroundColor: colors.error, borderColor: colors.error }}
                      textColor={colors.on_error}
                      accessibilityLabel={STRINGS.account.deleteSubmitAction}
                    />
                  </View>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 80,
    paddingRight: 16,
  },
  popoverCard: {
    minWidth: 160,
    borderWidth: 1,
  },
  popoverItem: {
    width: '100%',
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  deleteDialogCard: {
    width: '100%',
    maxWidth: 380,
    borderWidth: 1,
  },
  dialogContent: {
    width: '100%',
  },
  graceNoticeBox: {
    width: '100%',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  buttonHalf: {
    flex: 1,
  },
});
