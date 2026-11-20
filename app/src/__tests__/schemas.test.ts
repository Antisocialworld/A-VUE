import { describe, expect, it } from 'vitest';
import {
  checkPasswordRequirements,
  requestResetSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  verifyCodeSchema,
} from '../schemas/auth';
import { moviesSearchResponseSchema } from '../schemas/movies';

describe('A VUE Shared Zod Schemas', () => {
  describe('signInSchema', () => {
    it('accepts valid credentials and normalizes email', () => {
      const parsed = signInSchema.parse({
        email: ' User@Example.COM ',
        password: 'anypassword',
      });
      expect(parsed.email).toBe('user@example.com');
      expect(parsed.password).toBe('anypassword');
    });

    it('rejects unknown fields (strict mode)', () => {
      expect(() => {
        signInSchema.parse({
          email: 'user@example.com',
          password: 'password',
          extraField: 'not allowed',
        });
      }).toThrow();
    });

    it('rejects invalid email', () => {
      expect(() => {
        signInSchema.parse({
          email: 'not-an-email',
          password: 'password',
        });
      }).toThrow();
    });
  });

  describe('signUpSchema', () => {
    it('accepts compliant password: 8-128 chars, upper, lower, and digit or symbol', () => {
      const valid = signUpSchema.parse({
        email: 'user@example.com',
        password: 'Password123!',
      });
      expect(valid.email).toBe('user@example.com');
    });

    it('rejects passwords shorter than 8 characters', () => {
      expect(() => {
        signUpSchema.parse({
          email: 'user@example.com',
          password: 'Pass1!',
        });
      }).toThrow(/at least 8 characters/);
    });

    it('rejects passwords without uppercase', () => {
      expect(() => {
        signUpSchema.parse({
          email: 'user@example.com',
          password: 'password123!',
        });
      }).toThrow(/uppercase/);
    });

    it('rejects passwords without lowercase', () => {
      expect(() => {
        signUpSchema.parse({
          email: 'user@example.com',
          password: 'PASSWORD123!',
        });
      }).toThrow(/lowercase/);
    });

    it('rejects passwords without digit or symbol', () => {
      expect(() => {
        signUpSchema.parse({
          email: 'user@example.com',
          password: 'PasswordWithoutNumbers',
        });
      }).toThrow(/digit or symbol/);
    });

    it('rejects unknown fields (strict mode)', () => {
      expect(() => {
        signUpSchema.parse({
          email: 'user@example.com',
          password: 'Password123!',
          isAdmin: true,
        });
      }).toThrow();
    });
  });

  describe('verifyCodeSchema', () => {
    it('accepts exact 6-digit code', () => {
      const parsed = verifyCodeSchema.parse({
        email: 'user@example.com',
        code: '123456',
      });
      expect(parsed.code).toBe('123456');
    });

    it('rejects code shorter than 6 digits', () => {
      expect(() => {
        verifyCodeSchema.parse({
          email: 'user@example.com',
          code: '12345',
        });
      }).toThrow(/6 digits/);
    });

    it('rejects code with non-digit characters', () => {
      expect(() => {
        verifyCodeSchema.parse({
          email: 'user@example.com',
          code: '12345a',
        });
      }).toThrow(/6 digits/);
    });
  });

  describe('resetPasswordSchema', () => {
    it('accepts valid reset request', () => {
      const parsed = resetPasswordSchema.parse({
        email: 'user@example.com',
        code: '654321',
        newPassword: 'BrandNewPassword1#',
      });
      expect(parsed.newPassword).toBe('BrandNewPassword1#');
    });

    it('rejects unknown fields on reset', () => {
      expect(() => {
        resetPasswordSchema.parse({
          email: 'user@example.com',
          code: '654321',
          newPassword: 'BrandNewPassword1#',
          unexpected: 123,
        });
      }).toThrow();
    });
  });

  describe('moviesSearchResponseSchema matchedTitle', () => {
    const base = { movies: [], totalResults: 0, stale: false };

    it('accepts the optional matchedTitle field', () => {
      const parsed = moviesSearchResponseSchema.parse({
        ...base,
        matchedTitle: 'The Sound of Music',
      });
      expect(parsed.matchedTitle).toBe('The Sound of Music');
    });

    it('accepts a response without matchedTitle', () => {
      const parsed = moviesSearchResponseSchema.parse(base);
      expect(parsed.matchedTitle).toBeUndefined();
    });

    it('rejects matchedTitle over 120 characters', () => {
      expect(() =>
        moviesSearchResponseSchema.parse({ ...base, matchedTitle: 'a'.repeat(121) }),
      ).toThrow();
    });

    it('still rejects unknown fields (strict mode)', () => {
      expect(() => moviesSearchResponseSchema.parse({ ...base, unexpected: true })).toThrow();
    });
  });

  describe('checkPasswordRequirements helper', () => {
    it('checks all 4 rules live', () => {
      const empty = checkPasswordRequirements('');
      expect(empty.isAllValid).toBe(false);
      expect(empty.minLength).toBe(false);

      const partial = checkPasswordRequirements('pass');
      expect(partial.hasLowercase).toBe(true);
      expect(partial.hasUppercase).toBe(false);
      expect(partial.minLength).toBe(false);

      const complete = checkPasswordRequirements('CinemaTicket2026$');
      expect(complete.minLength).toBe(true);
      expect(complete.hasUppercase).toBe(true);
      expect(complete.hasLowercase).toBe(true);
      expect(complete.hasDigitOrSymbol).toBe(true);
      expect(complete.isAllValid).toBe(true);
    });
  });
});

