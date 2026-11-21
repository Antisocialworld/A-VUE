import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nodeRequire = createRequire(path.join(__dirname, 'paymentReturn.test.ts'));
let webBrowserModulePath: string | undefined;

const mocks = vi.hoisted(() => ({
  openAuthSessionAsync: vi.fn(),
  openBrowserAsync: vi.fn(),
  createURL: vi.fn(),
  canOpenURL: vi.fn(),
  openURL: vi.fn(),
}));

vi.mock('expo-web-browser', () => ({
  openAuthSessionAsync: mocks.openAuthSessionAsync,
  openBrowserAsync: mocks.openBrowserAsync,
}));
vi.mock('expo', () => ({}));
vi.mock('expo-linking', () => ({
  createURL: (appPath: string) => {
    mocks.createURL(appPath);
    return 'exp+avue://payment-return';
  },
}));
vi.mock('react-native', () => ({
  Linking: {
    canOpenURL: mocks.canOpenURL,
    openURL: mocks.openURL,
  },
}));

describe('Payment return auth session', () => {
  beforeEach(() => {
    vi.resetModules();
    (globalThis as any).__DEV__ = true;

    // browser.ts uses CommonJS require('expo-web-browser'); Vitest's ESM mock does
    // not intercept that require, so seed the CJS cache with the same stub module.
    webBrowserModulePath = nodeRequire.resolve('expo-web-browser');
    nodeRequire.cache[webBrowserModulePath] = {
      id: webBrowserModulePath,
      filename: webBrowserModulePath,
      loaded: true,
      exports: {
        openAuthSessionAsync: mocks.openAuthSessionAsync,
        openBrowserAsync: mocks.openBrowserAsync,
      },
    } as any;

    mocks.openAuthSessionAsync.mockReset().mockResolvedValue({ type: 'dismiss' });
    mocks.openBrowserAsync.mockReset().mockResolvedValue(undefined);
    mocks.createURL.mockReset().mockReturnValue('exp+avue://payment-return');
    mocks.canOpenURL.mockReset().mockResolvedValue(true);
    mocks.openURL.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (webBrowserModulePath) {
      delete nodeRequire.cache[webBrowserModulePath];
      webBrowserModulePath = undefined;
    }
  });

  it('opens checkout with openAuthSessionAsync and the configured return URL', async () => {
    const { openPaymentCheckoutSession } = await import('../utils/browser');

    const result = await openPaymentCheckoutSession('https://checkout.example/pay');

    expect(mocks.createURL).toHaveBeenCalledWith('payment-return');
    expect(mocks.openAuthSessionAsync).toHaveBeenCalledWith(
      'https://checkout.example/pay',
      'exp+avue://payment-return',
    );
    expect(result).toEqual({ type: 'dismiss' });
  });

  it('logs the computed return URL once in dev', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { openPaymentCheckoutSession } = await import('../utils/browser');

    await openPaymentCheckoutSession('https://checkout.example/pay');
    await openPaymentCheckoutSession('https://checkout.example/pay');

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      '[A VUE] APP_RETURN_URL for Expo Go: exp+avue://payment-return',
    );
  });

  it('keeps openBrowserAsync for every other browser use', async () => {
    const { openPaymentBrowser } = await import('../utils/browser');

    await openPaymentBrowser('https://example.com/help');

    expect(mocks.openBrowserAsync).toHaveBeenCalledWith('https://example.com/help');
    expect(mocks.openAuthSessionAsync).not.toHaveBeenCalled();
  });
});

describe('Checkout screen payment return flow', () => {
  const checkoutSrc = fs.readFileSync(
    path.resolve(__dirname, '../screens/CheckoutScreen.tsx'),
    'utf-8',
  );

  it('polls after any auth-session result without branching on success, cancel or dismiss', () => {
    const payBlock =
      checkoutSrc.match(/const handlePay = async \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';

    expect(checkoutSrc).toContain("import { openPaymentCheckoutSession } from '../utils/browser';");
    expect(payBlock).toMatch(
      /await openPaymentCheckoutSession\(res\.paymentLink\);[\s\S]*?pollForConfirmation\(\);/,
    );
    expect(payBlock).not.toMatch(/\bif\s*\(/);
    expect(payBlock).not.toMatch(/\b(success|cancel|dismiss)\b/);
  });
});
