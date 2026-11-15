import { z } from 'zod';

/**
 * Server Authentication Zod Schemas
 * Identical to app/src/schemas/auth.ts.
 * Rule: Unknown fields rejected (.strict()).
 * Password rule: 8–128 chars, upper + lower + (digit or printable symbol).
 * Sign-up code rule: 6 digits.
 */

// Base email schema (unique lowercase email)
export const emailSchema = z
  .string({ required_error: 'Email is required' })
  .trim()
  .toLowerCase()
  .min(1, { message: 'Email is required' })
  .email({ message: 'Please enter a valid email address' });

// Robust password schema (8-128 chars, upper, lower, digit or symbol)
export const robustPasswordSchema = z
  .string({ required_error: 'Password is required' })
  .min(8, { message: 'Password must be at least 8 characters' })
  .max(128, { message: 'Password cannot exceed 128 characters' })
  .refine((val) => /[A-Z]/.test(val), { message: 'Password requires at least one uppercase letter' })
  .refine((val) => /[a-z]/.test(val), { message: 'Password requires at least one lowercase letter' })
  .refine((val) => /[\d!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(val), {
    message: 'Password requires at least one digit or symbol',
  });

// Sign-in password schema (Rule: Sign-in never judges quality)
export const signInPasswordSchema = z
  .string({ required_error: 'Password is required' })
  .min(1, { message: 'Password is required' });

// 6-digit verification code schema
export const verificationCodeSchema = z
  .string({ required_error: 'Verification code is required' })
  .trim()
  .regex(/^\d{6}$/, { message: 'Verification code must be exactly 6 digits' });

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

// 7. Delete Account Schema (Task 4)
export const deleteAccountSchema = z
  .object({
    password: signInPasswordSchema,
    confirm: z.literal('DELETE'),
  })
  .strict();

export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;

// 8. Restore Account Schema (Task 4)
export const restoreAccountSchema = z
  .object({
    email: emailSchema,
    password: signInPasswordSchema,
  })
  .strict();

export type RestoreAccountInput = z.infer<typeof restoreAccountSchema>;

