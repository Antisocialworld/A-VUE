import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('App Checkout TEST MODE Badge Contract (Task 3)', () => {
  const checkoutScreenPath = path.resolve(__dirname, '../screens/CheckoutScreen.tsx');
  const cinemaClientPath = path.resolve(__dirname, '../api/cinemaClient.ts');
  const stringsPath = path.resolve(__dirname, '../constants/strings.ts');

  const checkoutSrc = fs.readFileSync(checkoutScreenPath, 'utf-8');
  const clientSrc = fs.readFileSync(cinemaClientPath, 'utf-8');
  const stringsSrc = fs.readFileSync(stringsPath, 'utf-8');

  it('fetches checkout config and derives testMode with fail-safe default true', () => {
    expect(clientSrc).toContain('getCheckoutConfig(): Promise<{ testMode: boolean }>');
    expect(clientSrc).toContain("'/checkout/config'");
    expect(clientSrc).toContain('return { testMode: true }');
    expect(checkoutSrc).toMatch(/cinemaClient\s*\.\s*getCheckoutConfig\(\)/);
    expect(checkoutSrc).toContain('useState<boolean>(true)');
  });

  it('conditionally renders TEST MODE badge only when testMode is true', () => {
    expect(checkoutSrc).toContain('const showTestModeBadge = checkoutData?.testMode ?? isTestMode');
    expect(checkoutSrc).toMatch(/\{showTestModeBadge\s*\?\s*\([\s\S]*?styles\.badgeWrapper[\s\S]*?\)\s*:\s*null\}/);
    expect(checkoutSrc).toContain('STRINGS.checkout.testModeBadge');
    expect(stringsSrc).toContain('testModeBadge:');
  });
});
