import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, CodeInput, FormError, PasswordField, ScreenShell, TextField } from '../components';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';
import { authClient, AuthSession } from '../api/authClient';
import { checkPasswordRequirements, signUpSchema, verifyCodeSchema } from '../schemas/auth';

export interface SignUpScreenProps {
  onBack: () => void;
  onNavigateToSignIn: () => void;
  onSignUpSuccess: (session: AuthSession) => void;
}

type SignUpStep = 'form' | 'verify_code';

export const SignUpScreen: React.FC<SignUpScreenProps> = ({
  onBack,
  onNavigateToSignIn,
  onSignUpSuccess,
}) => {
  const { colors, spacing, typography } = useTheme();

  const [step, setStep] = useState<SignUpStep>('form');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');

  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [passwordError, setPasswordError] = useState<string | undefined>(undefined);
  const [codeError, setCodeError] = useState<string | undefined>(undefined);

  // Resend cooldown timer (60s)
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (resendCooldown > 0) {
      timer = setTimeout(() => setResendCooldown((prev) => prev - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const passwordRequirements = checkPasswordRequirements(password);

  // Handle Form Submit (Step 1 -> Step 2)
  const handleFormSubmit = async () => {
    setFormError(null);
    setEmailError(undefined);
    setPasswordError(undefined);

    const validation = signUpSchema.safeParse({ email, password });
    if (!validation.success) {
      const fieldErrors = validation.error.flatten().fieldErrors;
      if (fieldErrors.email?.[0]) setEmailError(fieldErrors.email[0]);
      if (fieldErrors.password?.[0]) setPasswordError(fieldErrors.password[0]);
      return;
    }

    setLoading(true);
    try {
      await authClient.signUp(validation.data);
      setStep('verify_code');
      setResendCooldown(60); // 60s cooldown per AGENTS.md
    } catch (err: any) {
      setFormError(err.message || STRINGS.common.error);
    } finally {
      setLoading(false);
    }
  };

  // Handle Code Verification Submit (Step 2)
  const handleVerifySubmit = async () => {
    setFormError(null);
    setCodeError(undefined);

    const validation = verifyCodeSchema.safeParse({ email, code });
    if (!validation.success) {
      const fieldErrors = validation.error.flatten().fieldErrors;
      if (fieldErrors.code?.[0]) setCodeError(fieldErrors.code[0]);
      return;
    }

    setLoading(true);
    try {
      const session = await authClient.verifySignUpCode(validation.data);
      onSignUpSuccess(session);
    } catch (err: any) {
      setFormError(err.message || STRINGS.verifyCode.codeExpiredError);
    } finally {
      setLoading(false);
    }
  };

  // Handle Resend Code
  const handleResendCode = async () => {
    if (resendCooldown > 0 || resending) return;
    setFormError(null);
    setCodeError(undefined);
    setResending(true);

    try {
      const res = await authClient.resendSignUpCode(email);
      setResendCooldown(res.cooldownSeconds);
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setResending(false);
    }
  };

  const handleBack = () => {
    if (step === 'verify_code') {
      setStep('form');
      setFormError(null);
      setCode('');
    } else {
      onBack();
    }
  };

  if (step === 'verify_code') {
    return (
      <ScreenShell title={STRINGS.verifyCode.title} onBack={handleBack}>
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
            {STRINGS.verifyCode.subtitleWithEmail(email)}
          </Text>

          <FormError message={formError} />

          {/* 6-Digit Code Input */}
          <CodeInput
            value={code}
            autoFocus={true}
            onChangeText={(val) => {
              setCode(val);
              if (codeError) setCodeError(undefined);
              if (formError) setFormError(null);
            }}
            error={codeError}
            disabled={loading}
            style={{ marginBottom: spacing.xl }}
          />

          {/* Verify Button */}
          <Button
            title={loading ? STRINGS.verifyCode.verifyingButton : STRINGS.verifyCode.verifyButton}
            onPress={handleVerifySubmit}
            variant="primary"
            loading={loading}
            disabled={loading || code.length !== 6}
            style={{ marginBottom: spacing.md }}
          />

          {/* Resend Action with 60s cooldown */}
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

          {/* Change Email */}
          <View style={styles.centerRow}>
            <Button
              title={STRINGS.verifyCode.changeEmail}
              onPress={() => setStep('form')}
              variant="text"
              disabled={loading}
            />
          </View>
        </View>
      </ScreenShell>
    );
  }

  // Step 1: Sign up form
  return (
    <ScreenShell title={STRINGS.signUp.title} onBack={onBack}>
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
          {STRINGS.signUp.subtitle}
        </Text>

        <FormError message={formError} />

        {/* Email Field */}
        <TextField
          label={STRINGS.signUp.emailLabel}
          placeholder={STRINGS.signUp.emailPlaceholder}
          value={email}
          onChangeText={(val) => {
            setEmail(val);
            if (emailError) setEmailError(undefined);
            if (formError) setFormError(null);
          }}
          keyboardType="email-address"
          autoCapitalize="none"
          autoFocus={true}
          error={emailError}
          disabled={loading}
        />

        {/* Password Field with LIVE CHECKLIST */}
        <PasswordField
          label={STRINGS.signUp.passwordLabel}
          placeholder={STRINGS.signUp.passwordPlaceholder}
          value={password}
          onChangeText={(val) => {
            setPassword(val);
            if (passwordError) setPasswordError(undefined);
            if (formError) setFormError(null);
          }}
          showChecklist={true}
          error={passwordError}
          disabled={loading}
        />

        {/* Submit Button */}
        <Button
          title={loading ? STRINGS.signUp.submittingButton : STRINGS.signUp.submitButton}
          onPress={handleFormSubmit}
          variant="primary"
          loading={loading}
          disabled={loading || !email || !passwordRequirements.isAllValid}
          style={{ marginTop: spacing.md, marginBottom: spacing.lg }}
        />

        {/* Sign In Link */}
        <View style={styles.signInPromptRow}>
          <Text
            allowFontScaling
            style={[
              styles.promptText,
              {
                color: colors.on_surface_variant,
                fontFamily: typography.bodyMedium.fontFamily,
                fontSize: typography.bodyMedium.fontSize,
              },
            ]}
          >
            {STRINGS.signUp.haveAccountPrompt}{' '}
          </Text>
          <Button
            title={STRINGS.signUp.signInLink}
            onPress={onNavigateToSignIn}
            variant="text"
            disabled={loading}
            style={styles.inlineButton}
          />
        </View>
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
    marginVertical: 4,
  },
  cooldownText: {
    paddingVertical: 12,
  },
  signInPromptRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  promptText: {
    letterSpacing: -0.1,
  },
  inlineButton: {
    minHeight: 44,
    paddingHorizontal: 4,
  },
});

