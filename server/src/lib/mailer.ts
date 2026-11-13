/**
 * Nodemailer SMTP Mail Transport
 * Rule 02: One Nodemailer module over SMTP.
 * Transport mode chosen from env values:
 * - Real relay mode when both SMTP_USER and SMTP_PASS are set: auth, strict TLS, requireTLS on port 587, secure on port 465.
 * - Local catcher mode when neither is set: localhost/127.0.0.1 and non-production only, no auth, ignoreTLS true.
 * - Any other combination fails at startup naming env variable names only, never values.
 * Never prints verification codes, passwords, recipients, bodies or secrets to stdout/logs.
 * On failure, logs exactly one line: error class and code only.
 */

import nodemailer from 'nodemailer';
import { env, validateSmtpEnv } from '../env.js';

export interface SendMailResult {
  success: boolean;
  errorClass?: string;
  errorCode?: string;
}

/**
 * Derives Nodemailer transport options from environment configuration.
 * Mode is determined strictly from credentials (relay) vs no credentials (local catcher).
 * Checks on SMTP_PORT === 1025 and on NODE_ENV as mode pickers are removed.
 */
export function getSmtpTransportOptions(config: {
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  NODE_ENV: string;
}): nodemailer.TransportOptions {
  const { mode, auth } = validateSmtpEnv(config);

  if (mode === 'relay') {
    return {
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      requireTLS: config.SMTP_PORT === 587,
      ignoreTLS: false,
      tls: {
        rejectUnauthorized: true,
      },
      auth,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 5000,
    } as any;
  }

  // Local catcher mode
  return {
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: false,
    requireTLS: false,
    ignoreTLS: true,
    tls: {
      rejectUnauthorized: false,
    },
    auth: undefined,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 5000,
  } as any;
}

export const transporter = nodemailer.createTransport(getSmtpTransportOptions(env));

/**
 * Safely sends an email via SMTP.
 * On failure, logs exactly ONE line with error class and code only.
 * Never logs recipient, body, code, or credentials (Rule 02 / Task 1).
 * Does not throw, preserving route enumeration safety.
 */
export async function sendMailSafely(mailOptions: nodemailer.SendMailOptions): Promise<SendMailResult> {
  try {
    await transporter.sendMail(mailOptions);
    return { success: true };
  } catch (err: any) {
    const errorClass = err?.name || 'Error';
    const errorCode = err?.code || 'UNKNOWN';
    // Exactly one line: error class and code only (Rule 02 / Task 1)
    process.stderr.write(`[Mailer Error] ${errorClass}: ${errorCode}\n`);
    return {
      success: false,
      errorClass,
      errorCode,
    };
  }
}

/**
 * HTML Email Design Tokens Mapping (from color-tokens-orange-green-yellow.json):
 * - #FD550A: brand.mandarin_orange / roles.standard.light.primary (palettes.primary.40)
 * - #4A1200: roles.standard.light.on_primary_container (palettes.primary.10)
 * - #FFE7DF: roles.standard.light.primary_container (palettes.primary.90)
 * - #FFF4F1: palettes.neutral.97 (surface container lowest)
 * - #231917: roles.standard.light.on_surface (palettes.neutral.10)
 * - #53433F: roles.standard.light.on_surface_variant (palettes.neutral_variant.30)
 * - #85736E: roles.standard.light.outline (palettes.neutral_variant.50)
 * - #D8C2BB: roles.standard.light.outline_variant (palettes.neutral_variant.80)
 * - #FFFFFF: palettes.primary.100 (pure white)
 */

export async function sendVerificationCodeEmail(toEmail: string, code: string): Promise<SendMailResult> {
  const mailOptions: nodemailer.SendMailOptions = {
    from: env.MAIL_FROM,
    to: toEmail,
    subject: 'A VUE — Your Verification Code',
    text: `Your A VUE verification code is: ${code}\n\nThis code expires in 5 minutes. If you did not request this, please ignore this email.`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #FFE7DF; border-radius: 12px; background: #FFF4F1;">
        <h2 style="color: #FD550A; margin-top: 0;">A VUE</h2>
        <p style="color: #231917; font-size: 16px;">Here is your 6-digit verification code:</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; padding: 16px; background: #FFFFFF; border: 1px solid #D8C2BB; border-radius: 8px; text-align: center; color: #4A1200; margin: 20px 0;">
          ${code}
        </div>
        <p style="color: #53433F; font-size: 14px;">This code expires in 5 minutes. Maximum 5 attempts allowed.</p>
        <p style="color: #85736E; font-size: 12px; margin-bottom: 0;">A view. Your view. Our view.</p>
      </div>
    `,
  };

  return sendMailSafely(mailOptions);
}

export async function sendPasswordResetEmail(toEmail: string, code: string): Promise<SendMailResult> {
  const mailOptions: nodemailer.SendMailOptions = {
    from: env.MAIL_FROM,
    to: toEmail,
    subject: 'A VUE — Password Reset Code',
    text: `Your A VUE password reset code is: ${code}\n\nThis code expires in 5 minutes. If you did not request a password reset, please secure your account.`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #FFE7DF; border-radius: 12px; background: #FFF4F1;">
        <h2 style="color: #FD550A; margin-top: 0;">A VUE</h2>
        <p style="color: #231917; font-size: 16px;">You requested a password reset. Your 6-digit code is:</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; padding: 16px; background: #FFFFFF; border: 1px solid #D8C2BB; border-radius: 8px; text-align: center; color: #4A1200; margin: 20px 0;">
          ${code}
        </div>
        <p style="color: #53433F; font-size: 14px;">This code expires in 5 minutes. Never share this code with anyone.</p>
        <p style="color: #85736E; font-size: 12px; margin-bottom: 0;">A view. Your view. Our view.</p>
      </div>
    `,
  };

  return sendMailSafely(mailOptions);
}

/**
 * Enumeration safety notice email.
 * Sent when someone attempts to sign up with an already registered email.
 * Never leaks codes, passwords, or registration details.
 */
export async function sendAccountExistsNoticeEmail(toEmail: string): Promise<SendMailResult> {
  const mailOptions: nodemailer.SendMailOptions = {
    from: env.MAIL_FROM,
    to: toEmail,
    subject: 'A VUE — Sign-in Notice',
    text: `Someone attempted to create a new A VUE account using this email address. Since an account with this email already exists, no action was taken.\n\nIf this was you, you can sign in with your password or use the reset password option.\n\nA view. Your view. Our view.`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #FFE7DF; border-radius: 12px; background: #FFF4F1;">
        <h2 style="color: #FD550A; margin-top: 0;">A VUE</h2>
        <p style="color: #231917; font-size: 16px;">Notice: Account Registration Attempt</p>
        <p style="color: #53433F; font-size: 14px;">Someone attempted to register a new A VUE account using this email address. An account is already registered under this email, so no new account was created.</p>
        <p style="color: #53433F; font-size: 14px;">If this was you, you can sign in directly or reset your password if you have forgotten it.</p>
        <p style="color: #85736E; font-size: 12px; margin-bottom: 0;">A view. Your view. Our view.</p>
      </div>
    `,
  };

  return sendMailSafely(mailOptions);
}

/**
 * Task 2: Smoke test email.
 * Sends a fixed test message through the same transporter to the specified recipient.
 * Recipient comes from MAIL_TEST_TO. If missing, refuses to send.
 */
export async function sendSmokeTestEmail(toEmail: string): Promise<SendMailResult> {
  const recipient = toEmail?.trim();
  if (!recipient) {
    const errorClass = 'ValidationError';
    const errorCode = 'MISSING_RECIPIENT';
    process.stderr.write(`[Mailer Error] ${errorClass}: ${errorCode}\n`);
    return {
      success: false,
      errorClass,
      errorCode,
    };
  }

  const mailOptions: nodemailer.SendMailOptions = {
    from: env.MAIL_FROM,
    to: recipient,
    subject: 'A VUE — SMTP Test Message',
    text: 'This is a test message from A VUE mail smoke test.\n\nA view. Your view. Our view.',
  };

  return sendMailSafely(mailOptions);
}
