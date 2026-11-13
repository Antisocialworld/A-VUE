import { describe, expect, it } from 'vitest';
import {
  requestResetSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  verifyCodeSchema,
} from '../schemas/auth.js';

describe('Server Zod Schemas (Rule 02 Strictness & Criteria)', () => {
  describe('signInSchema', () => {
    it('accepts valid credentials and normalizes email to lowercase', () => {
      const parsed = signInSchema.parse({
        email: ' TestUser@Avue.App ',
        password: 'any-password',
      });
      expect(parsed.email).toBe('testuser@avue.app');
      expect(parsed.password).toBe('any-password');
    });

    it('rejects unknown fields (.strict())', () => {
      expect(() => {
        signInSchema.parse({
          email: 'test@avue.app',
          password: 'pass',
          unknownProp: 'malicious',
        });
      }).toThrow();
    });
  });

  describe('signUpSchema', () => {
    it('accepts password meeting all 4 criteria: 8-128, upper, lower, digit or symbol', () => {
      const parsed = signUpSchema.parse({
        email: 'newuser@avue.app',
        password: 'ValidPassword123!',
      });
      expect(parsed.email).toBe('newuser@avue.app');
    });

    it('rejects password lacking uppercase', () => {
      expect(() => {
        signUpSchema.parse({
          email: 'user@avue.app',
          password: 'password123!',
        });
      }).toThrow(/uppercase/);
    });

    it('rejects password lacking lowercase', () => {
      expect(() => {
        signUpSchema.parse({
          email: 'user@avue.app',
          password: 'PASSWORD123!',
        });
      }).toThrow(/lowercase/);
    });

    it('rejects password lacking digit or symbol', () => {
      expect(() => {
        signUpSchema.parse({
          email: 'user@avue.app',
          password: 'PasswordOnly',
        });
      }).toThrow(/digit or symbol/);
    });

    it('rejects password shorter than 8 characters', () => {
      expect(() => {
        signUpSchema.parse({
          email: 'user@avue.app',
          password: 'Pass1!',
        });
      }).toThrow(/at least 8 characters/);
    });

    it('rejects unknown fields (.strict())', () => {
      expect(() => {
        signUpSchema.parse({
          email: 'user@avue.app',
          password: 'ValidPassword123!',
          injected: 'bypass',
        });
      }).toThrow();
    });
  });

  describe('verifyCodeSchema', () => {
    it('accepts valid 6-digit code', () => {
      const parsed = verifyCodeSchema.parse({
        email: 'user@avue.app',
        code: '123456',
      });
      expect(parsed.code).toBe('123456');
    });

    it('rejects code with non-digit characters', () => {
      expect(() => {
        verifyCodeSchema.parse({
          email: 'user@avue.app',
          code: '12345a',
        });
      }).toThrow(/exactly 6 digits/);
    });

    it('rejects code not 6 digits in length', () => {
      expect(() => {
        verifyCodeSchema.parse({
          email: 'user@avue.app',
          code: '12345',
        });
      }).toThrow(/exactly 6 digits/);
    });
  });

  describe('resetPasswordSchema', () => {
    it('accepts valid reset payload and enforces robust password', () => {
      const parsed = resetPasswordSchema.parse({
        email: 'user@avue.app',
        code: '654321',
        newPassword: 'BrandNewPassword99#',
      });
      expect(parsed.newPassword).toBe('BrandNewPassword99#');
    });

    it('rejects unknown fields (.strict())', () => {
      expect(() => {
        resetPasswordSchema.parse({
          email: 'user@avue.app',
          code: '654321',
          newPassword: 'BrandNewPassword99#',
          adminOverride: true,
        });
      }).toThrow();
    });
  });
});

