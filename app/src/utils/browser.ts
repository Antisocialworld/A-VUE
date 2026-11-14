import { Linking } from 'react-native';

/**
 * A VUE Browser Launcher Utility
 * Opens external payment links via expo-web-browser in-app browser when installed,
 * falling back to device default browser via React Native Linking.
 */
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

