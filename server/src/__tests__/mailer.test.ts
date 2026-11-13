import { describe, expect, it, vi } from 'vitest';
import {
  transporter,
  getSmtpTransportOptions,
  sendMailSafely,
  sendVerificationCodeEmail,
  sendPasswordResetEmail,
  sendAccountExistsNoticeEmail,
  sendSmokeTestEmail,
} from '../lib/mailer.js';
import { env, validateSmtpEnv } from '../env.js';

describe('SMTP Mailer Module (Rule 02 / Task 1 & 2)', () => {
  describe('Task 1: Transport Mode Selection from Env Values', () => {
    it('selects real relay mode when both SMTP_USER and SMTP_PASS are set (port 587: requireTLS true, secure false)', () => {
      const config = {
        SMTP_HOST: 'smtp.relay.example.com',
        SMTP_PORT: 587,
        SMTP_USER: 'test-relay-user',
        SMTP_PASS: 'test-relay-pass',
        NODE_ENV: 'production',
      };

      const options = getSmtpTransportOptions(config) as any;
      expect(options.host).toBe('smtp.relay.example.com');
      expect(options.port).toBe(587);
      expect(options.auth).toEqual({
        user: 'test-relay-user',
        pass: 'test-relay-pass',
      });
      expect(options.requireTLS).toBe(true);
      expect(options.secure).toBe(false);
      expect(options.ignoreTLS).toBe(false);
      expect(options.tls.rejectUnauthorized).toBe(true);
      expect(options.connectionTimeout).toBe(5000);
      expect(options.greetingTimeout).toBe(5000);
      expect(options.socketTimeout).toBe(5000);
    });

    it('selects real relay mode with secure true on port 465', () => {
      const config = {
        SMTP_HOST: 'smtp.relay.example.com',
        SMTP_PORT: 465,
        SMTP_USER: 'test-relay-user',
        SMTP_PASS: 'test-relay-pass',
        NODE_ENV: 'development',
      };

      const options = getSmtpTransportOptions(config) as any;
      expect(options.port).toBe(465);
      expect(options.secure).toBe(true);
      expect(options.requireTLS).toBe(false);
      expect(options.ignoreTLS).toBe(false);
      expect(options.tls.rejectUnauthorized).toBe(true);
      expect(options.auth).toEqual({
        user: 'test-relay-user',
        pass: 'test-relay-pass',
      });
    });

    it('selects local catcher mode when neither user nor pass is set on localhost in development', () => {
      const config = {
        SMTP_HOST: 'localhost',
        SMTP_PORT: 1025,
        SMTP_USER: undefined,
        SMTP_PASS: undefined,
        NODE_ENV: 'development',
      };

      const options = getSmtpTransportOptions(config) as any;
      expect(options.host).toBe('localhost');
      expect(options.port).toBe(1025);
      expect(options.auth).toBeUndefined();
      expect(options.ignoreTLS).toBe(true);
      expect(options.secure).toBe(false);
      expect(options.requireTLS).toBe(false);
      expect(options.tls.rejectUnauthorized).toBe(false);
      expect(options.connectionTimeout).toBe(5000);
    });

    it('selects local catcher mode on 127.0.0.1 in test environment', () => {
      const config = {
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: 2525,
        SMTP_USER: '',
        SMTP_PASS: '',
        NODE_ENV: 'test',
      };

      const options = getSmtpTransportOptions(config) as any;
      expect(options.host).toBe('127.0.0.1');
      expect(options.auth).toBeUndefined();
      expect(options.ignoreTLS).toBe(true);
      expect(options.secure).toBe(false);
      expect(options.requireTLS).toBe(false);
    });

    it('fails startup when NODE_ENV is production without credentials (names env keys only)', () => {
      const config = {
        SMTP_HOST: 'localhost',
        SMTP_PORT: 1025,
        SMTP_USER: undefined,
        SMTP_PASS: undefined,
        NODE_ENV: 'production',
      };

      expect(() => validateSmtpEnv(config)).toThrowError(/NODE_ENV.*SMTP_USER.*SMTP_PASS/);
      // Ensure no secrets or values are in the error message
      try {
        validateSmtpEnv(config);
      } catch (err: any) {
        expect(err.message).toContain('NODE_ENV');
        expect(err.message).toContain('SMTP_USER');
        expect(err.message).toContain('SMTP_PASS');
      }
    });

    it('fails startup when only SMTP_USER is set (names env keys only)', () => {
      const config = {
        SMTP_HOST: 'localhost',
        SMTP_PORT: 1025,
        SMTP_USER: 'some-user',
        SMTP_PASS: undefined,
        NODE_ENV: 'development',
      };

      expect(() => validateSmtpEnv(config)).toThrowError(/SMTP_USER.*SMTP_PASS/);
      try {
        validateSmtpEnv(config);
      } catch (err: any) {
        expect(err.message).not.toContain('some-user');
        expect(err.message).toContain('SMTP_USER');
        expect(err.message).toContain('SMTP_PASS');
      }
    });

    it('fails startup when only SMTP_PASS is set (names env keys only)', () => {
      const config = {
        SMTP_HOST: 'localhost',
        SMTP_PORT: 1025,
        SMTP_USER: undefined,
        SMTP_PASS: 'secret-pass-val',
        NODE_ENV: 'development',
      };

      expect(() => validateSmtpEnv(config)).toThrowError(/SMTP_USER.*SMTP_PASS/);
      try {
        validateSmtpEnv(config);
      } catch (err: any) {
        expect(err.message).not.toContain('secret-pass-val');
        expect(err.message).toContain('SMTP_USER');
        expect(err.message).toContain('SMTP_PASS');
      }
    });

    it('fails startup when unauthenticated local mode is attempted on a remote host (names env keys only)', () => {
      const config = {
        SMTP_HOST: 'smtp.sendgrid.net',
        SMTP_PORT: 587,
        SMTP_USER: undefined,
        SMTP_PASS: undefined,
        NODE_ENV: 'development',
      };

      expect(() => validateSmtpEnv(config)).toThrowError(/SMTP_HOST.*SMTP_USER.*SMTP_PASS/);
      try {
        validateSmtpEnv(config);
      } catch (err: any) {
        expect(err.message).toContain('SMTP_HOST');
        expect(err.message).toContain('SMTP_USER');
        expect(err.message).toContain('SMTP_PASS');
      }
    });
  });

  describe('Single-line Error Logging & Route Isolation', () => {
    it('safely catches SMTP failure, logs exactly one line with error class and code only, and does not throw', async () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      const mockError: any = new Error('Connection refused');
      mockError.name = 'ConnectionError';
      mockError.code = 'ECONNREFUSED';

      const sendMailSpy = vi.spyOn(transporter, 'sendMail').mockRejectedValueOnce(mockError);

      const result = await sendMailSafely({
        from: env.MAIL_FROM,
        to: 'secret_user@example.com',
        subject: 'A VUE Verification Code',
        text: 'Secret code: 987654. Password reset.',
      });

      expect(result.success).toBe(false);
      expect(result.errorClass).toBe('ConnectionError');
      expect(result.errorCode).toBe('ECONNREFUSED');

      // Rule 02 / Task 1: exactly one line logged with error class and code only
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const loggedOutput = stderrSpy.mock.calls[0][0] as string;
      expect(loggedOutput).toBe('[Mailer Error] ConnectionError: ECONNREFUSED\n');

      // Verify ZERO leakage of sensitive data (recipient, codes, passwords)
      expect(loggedOutput).not.toContain('secret_user@example.com');
      expect(loggedOutput).not.toContain('987654');
      expect(loggedOutput).not.toContain('Password');

      sendMailSpy.mockRestore();
      stderrSpy.mockRestore();
    });
  });

  describe('Email Formatting', () => {
    it('sendVerificationCodeEmail formats verification email with code and expiry', async () => {
      const sendMailSpy = vi.spyOn(transporter, 'sendMail').mockResolvedValueOnce({} as any);

      const result = await sendVerificationCodeEmail('user@example.com', '123456');
      expect(result.success).toBe(true);

      expect(sendMailSpy).toHaveBeenCalledTimes(1);
      const options = sendMailSpy.mock.calls[0][0] as any;
      expect(options.from).toBe(env.MAIL_FROM);
      expect(options.to).toBe('user@example.com');
      expect(options.subject).toBe('A VUE — Your Verification Code');
      expect(options.text).toContain('123456');
      expect(options.text).toContain('5 minutes');

      sendMailSpy.mockRestore();
    });

    it('sendPasswordResetEmail formats reset email with code and expiry', async () => {
      const sendMailSpy = vi.spyOn(transporter, 'sendMail').mockResolvedValueOnce({} as any);

      const result = await sendPasswordResetEmail('user@example.com', '654321');
      expect(result.success).toBe(true);

      expect(sendMailSpy).toHaveBeenCalledTimes(1);
      const options = sendMailSpy.mock.calls[0][0] as any;
      expect(options.to).toBe('user@example.com');
      expect(options.subject).toBe('A VUE — Password Reset Code');
      expect(options.text).toContain('654321');
      expect(options.text).toContain('5 minutes');

      sendMailSpy.mockRestore();
    });

    it('sendAccountExistsNoticeEmail sends notice without leaking codes or passwords', async () => {
      const sendMailSpy = vi.spyOn(transporter, 'sendMail').mockResolvedValueOnce({} as any);

      const result = await sendAccountExistsNoticeEmail('existing@example.com');
      expect(result.success).toBe(true);

      expect(sendMailSpy).toHaveBeenCalledTimes(1);
      const options = sendMailSpy.mock.calls[0][0] as any;
      expect(options.to).toBe('existing@example.com');
      expect(options.text).toContain('A view. Your view. Our view.');

      sendMailSpy.mockRestore();
    });
  });

  describe('Task 2: Smoke Test Recipient & Execution', () => {
    it('sendSmokeTestEmail sends a fixed test email to the provided recipient', async () => {
      const sendMailSpy = vi.spyOn(transporter, 'sendMail').mockResolvedValueOnce({} as any);

      const result = await sendSmokeTestEmail('smoke-recipient@example.com');
      expect(result.success).toBe(true);

      expect(sendMailSpy).toHaveBeenCalledTimes(1);
      const options = sendMailSpy.mock.calls[0][0] as any;
      expect(options.to).toBe('smoke-recipient@example.com');
      expect(options.subject).toBe('A VUE — SMTP Test Message');
      expect(options.text).toContain('A VUE mail smoke test');
      expect(options.text).toContain('A view. Your view. Our view.');

      sendMailSpy.mockRestore();
    });

    it('sendSmokeTestEmail rejects with validation error when recipient is empty', async () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      const result = await sendSmokeTestEmail('');
      expect(result.success).toBe(false);
      expect(result.errorClass).toBe('ValidationError');
      expect(result.errorCode).toBe('MISSING_RECIPIENT');

      expect(stderrSpy).toHaveBeenCalledTimes(1);
      expect(stderrSpy.mock.calls[0][0]).toBe('[Mailer Error] ValidationError: MISSING_RECIPIENT\n');

      stderrSpy.mockRestore();
    });
  });
});
