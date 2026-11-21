import * as ExpoLinking from 'expo-linking';
import { Linking } from 'react-native';

const PAYMENT_RETURN_PATH = 'payment-return';
let hasLoggedPaymentReturnUrl = false;

/**
 * A VUE Browser Launcher Utility
 * Opens external payment links via expo-web-browser in-app browser when installed,
 * falling back to device default browser via React Native Linking.
 */
export function getPaymentReturnUrl(): string {
  return ExpoLinking.createURL(PAYMENT_RETURN_PATH);
}

function logPaymentReturnUrlInDev(returnUrl: string): void {
  const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : false;
  if (!isDev || hasLoggedPaymentReturnUrl) return;
  hasLoggedPaymentReturnUrl = true;
  console.log(`[A VUE] APP_RETURN_URL for Expo Go: ${returnUrl}`);
}

/**
 * Opens Flutterwave hosted checkout as an auth session so the configured app
 * return URL can close the browser cleanly. The caller ignores the result.
 */
export async function openPaymentCheckoutSession(url: string): Promise<unknown> {
  const WebBrowser = require('expo-web-browser');
  const returnUrl = getPaymentReturnUrl();
  logPaymentReturnUrlInDev(returnUrl);
  return WebBrowser.openAuthSessionAsync(url, returnUrl);
}

export async function openPaymentBrowser(url: string): Promise<void> {
  try {
    const WebBrowser = require('expo-web-browser');
    if (WebBrowser && typeof WebBrowser.openBrowserAsync === 'function') {
      await WebBrowser.openBrowserAsync(url);
      return;
    }
  } catch {
    // expo-web-browser not installed; fall through to Linking
  }

  const supported = await Linking.canOpenURL(url);
  if (supported) {
    await Linking.openURL(url);
  } else {
    throw new Error('Cannot open payment link');
  }
}
