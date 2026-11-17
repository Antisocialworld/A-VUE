import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, CodeInput, FormError, PasswordField, ScreenShell, TextField } from '../components';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';
import { authClient } from '../api/authClient';
import {
  checkPasswordRequirements,
  requestResetSchema,
  resetPasswordSchema,
} from '../schemas/auth';
import { getDisplayMessage } from '../utils/error';

export interface ResetPasswordScreenProps {
  onBack: () => void;
  onNavigateToSignIn: () => void;
}

type ResetStep = 'request' | 'verify_and_set' | 'completed';

export const ResetPasswordScreen: React.FC<ResetPasswordScreenProps> = ({
  onBack,
  onNavigateToSignIn,
}) => {
  const { colors, spacing, typography } = useTheme();

  const [step, setStep] = useState<ResetStep>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [codeError, setCodeError] = useState<string | undefined>(undefined);
  const [passwordError, setPasswordError] = useState<string | undefined>(undefined);

  const passwordInputRef = useRef<React.ComponentRef<typeof TextInput>>(null);

  // Resend cooldown timer (60s)
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (resendCooldown > 0) {
      timer = setTimeout(() => setResendCooldown((prev) => prev - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const passwordRequirements = checkPasswordRequirements(newPassword);

  // Step 1: Send Reset Code
  const handleRequestSubmit = async () => {
    setFormError(null);
    setEmailError(undefined);

    const validation = requestResetSchema.safeParse({ email });
    if (!validation.success) {
      const fieldErrors = validation.error.flatten().fieldErrors;
      if (fieldErrors.email?.[0]) setEmailError(fieldErrors.email[0]);
      return;
    }

    setLoading(true);
    try {
      const res = await authClient.requestPasswordReset(validation.data);
      setStep('verify_and_set');
      setResendCooldown(res.cooldownSeconds);
    } catch (err: any) {
      setFormError(getDisplayMessage(err, STRINGS.common.error));
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Verify Code and Set New Password
  const handleResetSubmit = async () => {
    setFormError(null);
    setCodeError(undefined);
    setPasswordError(undefined);

    const validation = resetPasswordSchema.safeParse({ email, code, newPassword });
    if (!validation.success) {
      const fieldErrors = validation.error.flatten().fieldErrors;
      if (fieldErrors.code?.[0]) setCodeError(fieldErrors.code[0]);
      if (fieldErrors.newPassword?.[0]) setPasswordError(fieldErrors.newPassword[0]);
      return;
    }

    setLoading(true);
    try {
      await authClient.resetPassword(validation.data);
      setStep('completed');
    } catch (err: any) {
      setFormError(getDisplayMessage(err, STRINGS.common.error));
    } finally {
      setLoading(false);
    }
  };

  // Resend Code
  const handleResendCode = async () => {
    if (resendCooldown > 0 || resending) return;
    setResending(true);
    setFormError(null);

    try {
      const res = await authClient.requestPasswordReset({ email });
      setResendCooldown(res.cooldownSeconds);
    } catch (err: any) {
      setFormError(getDisplayMessage(err, STRINGS.common.error));
    } finally {
      setResending(false);
    }
  };

  // Step 3: Success Screen
  if (step === 'completed') {
    return (
      <ScreenShell title={STRINGS.resetPassword.confirmTitle} onBack={onNavigateToSignIn}>
        <View style={styles.content}>
          <Text
            allowFontScaling
            style={[
              styles.subtitle,
              {
                color: colors.on_surface,
                marginBottom: spacing.xl,
                fontFamily: typography.headlineSmall.fontFamily,
                fontSize: typography.headlineSmall.fontSize,
                fontWeight: typography.headlineSmall.fontWeight,
                lineHeight: typography.headlineSmall.lineHeight,
              },
            ]}
          >
            {STRINGS.resetPassword.successMessage}
          </Text>

          <Button
            title={STRINGS.resetPassword.backToSignIn}
            onPress={onNavigateToSignIn}
            variant="primary"
            style={{ marginTop: spacing.md }}
          />
        </View>
      </ScreenShell>
    );
  }

  // Step 2: Enter Code & New Password
  if (step === 'verify_and_set') {
    return (
      <ScreenShell
        title={STRINGS.resetPassword.confirmTitle}
        onBack={() => {
          setStep('request');
          setFormError(null);
        }}
      >
        <View style={styles.content}>
          <Text
            allowFontScaling
            style={[
              styles.subtitle,
              {
                color: colors.on_surface_variant,
                marginBottom: spacing.lg,
                fontFamily: typography.bodyMedium.fontFamily,
                fontSize: typography.bodyMedium.fontSize,
                lineHeight: typography.bodyMedium.lineHeight,
              },
            ]}
          >
            {STRINGS.resetPassword.confirmSubtitle}
          </Text>

          <FormError message={formError} />

          {/* 6-Digit Code */}
          <CodeInput
            value={code}
            autoFocus={code.length < 6}
            onChangeText={(val) => {
              setCode(val);
              if (codeError) setCodeError(undefined);
              if (formError) setFormError(null);
              if (val.length === 6) {
                // When 6 digits are entered, automatically advance focus to new password
                passwordInputRef.current?.focus();
              }
            }}
            error={codeError}
            disabled={loading}
            style={{ marginBottom: spacing.lg }}
          />

          {/* New Password with Checklist */}
          <PasswordField
            ref={passwordInputRef}
            label={STRINGS.resetPassword.newPasswordLabel}
            placeholder={STRINGS.resetPassword.newPasswordPlaceholder}
            value={newPassword}
            autoFocus={code.length === 6}
            onChangeText={(val) => {
              setNewPassword(val);
              if (passwordError) setPasswordError(undefined);
              if (formError) setFormError(null);
            }}
            showChecklist={true}
            error={passwordError}
            disabled={loading}
          />

          {/* Submit Reset Button */}
          <Button
            title={
              loading
                ? STRINGS.resetPassword.submittingButton
                : STRINGS.resetPassword.submitButton
            }
            onPress={handleResetSubmit}
            variant="primary"
            loading={loading}
            disabled={loading || code.length !== 6 || !passwordRequirements.isAllValid}
            style={{ marginTop: spacing.md, marginBottom: spacing.md }}
          />

          {/* Resend Code */}
          <View style={styles.centerRow}>
            {resendCooldown > 0 ? (
              <Text
                allowFontScaling
                style={[
                  styles.cooldownText,
                  {
                    color: colors.outline,
                    fontFamily: typography.bodyMedium.fontFamily,
                    fontSize: typography.bodyMedium.fontSize,
                  },
                ]}
              >
                {STRINGS.verifyCode.resendCooldown(resendCooldown)}
              </Text>
            ) : (
              <Button
                title={STRINGS.verifyCode.resendButton}
                onPress={handleResendCode}
                variant="text"
                loading={resending}
                disabled={loading || resending}
              />
            )}
          </View>
        </View>
      </ScreenShell>
    );
  }

  // Step 1: Request Reset
  return (
    <ScreenShell title={STRINGS.resetPassword.requestTitle} onBack={onBack}>
      <View style={styles.content}>
        <Text
          allowFontScaling
          style={[
            styles.subtitle,
            {
              color: colors.on_surface_variant,
              marginBottom: spacing.xl,
              fontFamily: typography.bodyMedium.fontFamily,
              fontSize: typography.bodyMedium.fontSize,
              lineHeight: typography.bodyMedium.lineHeight,
            },
          ]}
        >
          {STRINGS.resetPassword.requestSubtitle}
        </Text>

        <FormError message={formError} />

        <TextField
          label={STRINGS.signIn.emailLabel}
          placeholder={STRINGS.signIn.emailPlaceholder}
          value={email}
          autoFocus={true}
          onChangeText={(val) => {
            setEmail(val);
            if (emailError) setEmailError(undefined);
            if (formError) setFormError(null);
          }}
          keyboardType="email-address"
          autoCapitalize="none"
          error={emailError}
          disabled={loading}
        />

        <Button
          title={
            loading
              ? STRINGS.resetPassword.sendingCodeButton
              : STRINGS.resetPassword.sendCodeButton
          }
          onPress={handleRequestSubmit}
          variant="primary"
          loading={loading}
          disabled={loading || !email}
          style={{ marginTop: spacing.md }}
        />
      </View>
    </ScreenShell>
  );
};

const styles = StyleSheet.create({
  content: {
    width: '100%',
    paddingTop: 8,
  },
  subtitle: {
    letterSpacing: -0.1,
  },
  centerRow: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  cooldownText: {
    letterSpacing: -0.08,
  },
});
