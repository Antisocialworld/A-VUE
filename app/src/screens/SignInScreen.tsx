import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, FormError, PasswordField, ScreenShell, TextField } from '../components';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';
import { authClient, AuthSession, AccountScheduledForDeletionError } from '../api/authClient';
import { signInSchema } from '../schemas/auth';

export interface SignInScreenProps {
  onBack: () => void;
  onNavigateToSignUp: () => void;
  onNavigateToResetPassword: () => void;
  onSignInSuccess: (session: AuthSession) => void;
}

export const SignInScreen: React.FC<SignInScreenProps> = ({
  onBack,
  onNavigateToSignUp,
  onNavigateToResetPassword,
  onSignInSuccess,
}) => {
  const { colors, spacing, typography } = useTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [passwordError, setPasswordError] = useState<string | undefined>(undefined);

  const handleSubmit = async () => {
    setFormError(null);
    setEmailError(undefined);
    setPasswordError(undefined);

    const validationResult = signInSchema.safeParse({ email, password });
    if (!validationResult.success) {
      const fieldErrors = validationResult.error.flatten().fieldErrors;
      if (fieldErrors.email?.[0]) setEmailError(fieldErrors.email[0]);
      if (fieldErrors.password?.[0]) setPasswordError(fieldErrors.password[0]);
      return;
    }

    setLoading(true);
    try {
      const session = await authClient.signIn(validationResult.data);
      onSignInSuccess(session);
    } catch (err: any) {
      if (
        err instanceof AccountScheduledForDeletionError ||
        err?.name === 'AccountScheduledForDeletionError' ||
        err?.code === 'ACCOUNT_SCHEDULED_FOR_DELETION'
      ) {
        setFormError(null);
      } else {
        setFormError(err.message || STRINGS.signIn.invalidCredentialsError);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenShell title={STRINGS.signIn.title} onBack={onBack}>
      <View style={styles.content}>
        {/* Subtitle */}
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
          {STRINGS.signIn.subtitle}
        </Text>

        {/* Form-level error banner */}
        <FormError message={formError} />

        {/* Email Field */}
        <TextField
          label={STRINGS.signIn.emailLabel}
          placeholder={STRINGS.signIn.emailPlaceholder}
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

        {/* Password Field (No checklist for sign-in) */}
        <PasswordField
          label={STRINGS.signIn.passwordLabel}
          placeholder={STRINGS.signIn.passwordPlaceholder}
          value={password}
          onChangeText={(val) => {
            setPassword(val);
            if (passwordError) setPasswordError(undefined);
            if (formError) setFormError(null);
          }}
          showChecklist={false}
          error={passwordError}
          disabled={loading}
        />

        {/* Forgot Password Link */}
        <View style={styles.forgotContainer}>
          <Button
            title={STRINGS.signIn.forgotPassword}
            onPress={onNavigateToResetPassword}
            variant="text"
            disabled={loading}
            style={styles.forgotButton}
          />
        </View>

        {/* Submit Button */}
        <Button
          title={loading ? STRINGS.signIn.submittingButton : STRINGS.signIn.submitButton}
          onPress={handleSubmit}
          variant="primary"
          loading={loading}
          disabled={loading || !email || !password}
          style={{ marginTop: spacing.md, marginBottom: spacing.lg }}
        />

        {/* Sign Up Redirect */}
        <View style={styles.signUpPromptRow}>
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
            {STRINGS.signIn.noAccountPrompt}{' '}
          </Text>
          <Button
            title={STRINGS.signIn.signUpLink}
            onPress={onNavigateToSignUp}
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
  forgotContainer: {
    alignItems: 'flex-end',
    width: '100%',
  },
  forgotButton: {
    minHeight: 44,
    paddingHorizontal: 0,
  },
  signUpPromptRow: {
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

