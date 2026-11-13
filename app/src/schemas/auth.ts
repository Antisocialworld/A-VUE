import { z } from 'zod';
import { STRINGS } from '../constants/strings';

/**
 * Shared Zod schemas for A VUE authentication.
 * Rule: Unknown fields rejected (.strict()).
 * Password rule: 8–128 chars, upper + lower + (digit or printable symbol).
 * Sign-up code rule: 6 digits.
 */

export interface PasswordRequirements {
  minLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasDigitOrSymbol: boolean;
  isAllValid: boolean;
}

export const checkPasswordRequirements = (password: string): PasswordRequirements => {
  const minLength = password.length >= 8 && password.length <= 128;
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  // Printable symbols or digits
  const hasDigitOrSymbol = /[\d!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(password);

  return {
    minLength,
    hasUppercase,
    hasLowercase,
    hasDigitOrSymbol,
    isAllValid: minLength && hasUppercase && hasLowercase && hasDigitOrSymbol,
  };
};

// Base email schema
export const emailSchema = z
  .string({ required_error: STRINGS.validation.emailRequired })
  .trim()
  .toLowerCase()
  .min(1, { message: STRINGS.validation.emailRequired })
  .email({ message: STRINGS.validation.emailInvalid });

// Password schema with full criteria (used for sign-up and password reset)
export const robustPasswordSchema = z
  .string({ required_error: STRINGS.validation.passwordRequired })
  .min(8, { message: STRINGS.validation.passwordTooShort })
  .max(128, { message: STRINGS.validation.passwordTooLong })
  .refine((val) => /[A-Z]/.test(val), { message: STRINGS.validation.passwordNeedsUpper })
  .refine((val) => /[a-z]/.test(val), { message: STRINGS.validation.passwordNeedsLower })
  .refine((val) => /[\d!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(val), {
    message: STRINGS.validation.passwordNeedsDigitOrSymbol,
  });

// Sign-in password schema (Rule: Sign-in never judges quality)
export const signInPasswordSchema = z
  .string({ required_error: STRINGS.validation.passwordRequired })
  .min(1, { message: STRINGS.validation.passwordRequired });

// 6-digit code schema
export const verificationCodeSchema = z
  .string({ required_error: STRINGS.validation.codeRequired })
  .trim()
  .regex(/^\d{6}$/, { message: STRINGS.validation.codeInvalidLength });

// 1. Sign In Form Schema
export const signInSchema = z
  .object({
    email: emailSchema,
    password: signInPasswordSchema,
  })
  .strict();

export type SignInInput = z.infer<typeof signInSchema>;

// 2. Sign Up Form Schema
export const signUpSchema = z
  .object({
    email: emailSchema,
    password: robustPasswordSchema,
  })
  .strict();

export type SignUpInput = z.infer<typeof signUpSchema>;

// 3. Verify Code Schema
export const verifyCodeSchema = z
  .object({
    email: emailSchema,
    code: verificationCodeSchema,
  })
  .strict();

export type VerifyCodeInput = z.infer<typeof verifyCodeSchema>;

// 4. Resend Code Schema
export const resendCodeSchema = z
  .object({
    email: emailSchema,
  })
  .strict();

export type ResendCodeInput = z.infer<typeof resendCodeSchema>;

// 5. Request Reset Password Schema
export const requestResetSchema = z
  .object({
    email: emailSchema,
  })
  .strict();

export type RequestResetInput = z.infer<typeof requestResetSchema>;

// 6. Reset Password Schema
export const resetPasswordSchema = z
  .object({
    email: emailSchema,
    code: verificationCodeSchema,
    newPassword: robustPasswordSchema,
  })
  .strict();

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

