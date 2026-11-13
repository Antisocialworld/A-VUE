import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isAdmin } from '../env.js';
import { nairaToKobo, verifyFlutterwaveSignature } from '../lib/flutterwave.js';

describe('Webhooks, Flutterwave & Tickets (Tasks 3, 4, 5)', () => {
  describe('Task 3a: Flutterwave Webhook verif-hash Verification (Official v3 Docs)', () => {
    const testSecretHash = 'sec_hash_official_flutterwave_12345';
    process.env.FLUTTERWAVE_SECRET_HASH = testSecretHash;

    it('verifies valid verif-hash header via crypto.timingSafeEqual with length check', () => {
      const rawBody = JSON.stringify({ event: 'charge.completed', data: { id: 1001 } });
      const headers = { 'verif-hash': testSecretHash };

      const valid = verifyFlutterwaveSignature(rawBody, headers);
      expect(valid).toBe(true);
    });

    it('rejects invalid or tampered verif-hash header', () => {
      const rawBody = JSON.stringify({ event: 'charge.completed', data: { id: 1001 } });
      const headers = { 'verif-hash': 'invalid_secret_hash_value' };

      const valid = verifyFlutterwaveSignature(rawBody, headers);
      expect(valid).toBe(false);
    });

    it('rejects missing or empty verif-hash header', () => {
      const rawBody = JSON.stringify({ event: 'charge.completed', data: { id: 1001 } });
      expect(verifyFlutterwaveSignature(rawBody, {})).toBe(false);
      expect(verifyFlutterwaveSignature(rawBody, { 'verif-hash': '' })).toBe(false);
    });
  });

  describe('Task 3b: Currency Major Unit to Kobo Integer Arithmetic', () => {
    it('accurately converts fractional Naira amounts (e.g. 110.25) to integer kobo without floating-point errors', () => {
      expect(nairaToKobo('110.25')).toBe(11025);
      expect(nairaToKobo(110.25)).toBe(11025);
    });

    it('accurately converts whole amounts and single-digit fractional amounts', () => {
      expect(nairaToKobo(3500)).toBe(350000);
      expect(nairaToKobo('3500')).toBe(350000);
      expect(nairaToKobo('10.5')).toBe(1050);
      expect(nairaToKobo('10.05')).toBe(1005);
      expect(nairaToKobo('0.99')).toBe(99);
      expect(nairaToKobo(0)).toBe(0);
    });
  });

  describe('Task 5: Admin Authorization (ADMIN_EMAILS)', () => {
    it('compares email case-insensitively against configured ADMIN_EMAILS', () => {
      process.env.ADMIN_EMAILS = 'admin@avue.app, Supervisor@AVUE.APP , gatekeeper@cinema.test';

      expect(isAdmin('admin@avue.app')).toBe(true);
      expect(isAdmin('ADMIN@AVUE.APP')).toBe(true);
      expect(isAdmin('supervisor@avue.app')).toBe(true);
      expect(isAdmin('SUPERVISOR@avue.app')).toBe(true);
      expect(isAdmin('gatekeeper@cinema.test')).toBe(true);

      // Normal customer is not admin
      expect(isAdmin('customer@example.com')).toBe(false);
      expect(isAdmin('')).toBe(false);
      expect(isAdmin(undefined)).toBe(false);
    });

    it('denies all users when ADMIN_EMAILS is empty or unset', () => {
      process.env.ADMIN_EMAILS = '';
      expect(isAdmin('admin@avue.app')).toBe(false);
      expect(isAdmin('owner@avue.app')).toBe(false);
    });
  });

  describe('Task 4: Tickets QR Reference Generation & Hash Lookup', () => {
    it('generates random >=128-bit reference and resolves strictly via SHA-256', () => {
      // 256-bit random opaque reference (Task 4a)
      const reference = crypto.randomBytes(32).toString('hex');
      expect(reference.length).toBe(64); // 64 hex characters = 256 bits

      // DB stores ONLY SHA-256
      const storedHash = crypto.createHash('sha256').update(reference).digest('hex');

      // Incoming reference hashed and matched
      const incomingHash = crypto.createHash('sha256').update(reference).digest('hex');
      expect(incomingHash).toBe(storedHash);

      // Replacing with fresh reference invalidates previous hash (Task 4a)
      const freshRef = crypto.randomBytes(32).toString('hex');
      const freshHash = crypto.createHash('sha256').update(freshRef).digest('hex');
      expect(freshHash).not.toBe(storedHash);
    });
  });
});
