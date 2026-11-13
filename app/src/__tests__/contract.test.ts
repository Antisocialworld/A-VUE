import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  verifyCodeSchema,
} from '../schemas/auth';

describe('App Schema Contract Conformance Test (Task 10)', () => {
  // Correct relative path: from app/src/__tests__ (3 levels up to repo root)
  const contractPath = path.resolve(__dirname, '../../../contracts/auth-cases.json');

  it('contract file exists at repo root', () => {
    expect(fs.existsSync(contractPath)).toBe(true);
  });

  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf-8'));

  describe('signInSchema contract cases', () => {
    contract.cases.signIn.forEach((tc: any) => {
      it(tc.description, () => {
        const res = signInSchema.safeParse(tc.input);
        expect(res.success).toBe(tc.expectedValid);
        if (tc.expectedValid && tc.normalizedEmail) {
          expect((res as any).data.email).toBe(tc.normalizedEmail);
        }
      });
    });
  });

  describe('signUpSchema contract cases', () => {
    contract.cases.signUp.forEach((tc: any) => {
      it(tc.description, () => {
        const res = signUpSchema.safeParse(tc.input);
        expect(res.success).toBe(tc.expectedValid);
        if (tc.expectedValid && tc.normalizedEmail) {
          expect((res as any).data.email).toBe(tc.normalizedEmail);
        }
      });
    });
  });

  describe('verifyCodeSchema contract cases', () => {
    contract.cases.verifyCode.forEach((tc: any) => {
      it(tc.description, () => {
        const res = verifyCodeSchema.safeParse(tc.input);
        expect(res.success).toBe(tc.expectedValid);
      });
    });
  });

  describe('resetPasswordSchema contract cases', () => {
    contract.cases.resetPassword.forEach((tc: any) => {
      it(tc.description, () => {
        const res = resetPasswordSchema.safeParse(tc.input);
        expect(res.success).toBe(tc.expectedValid);
      });
    });
  });
});

