/**
 * A VUE Haptic Feedback Helper
 * Uses expo-haptics when installed; safely no-ops otherwise.
 */

export async function triggerSeatSelectHaptic(): Promise<void> {
  try {
    const Haptics = require('expo-haptics');
    if (Haptics && typeof Haptics.selectionAsync === 'function') {
      await Haptics.selectionAsync();
    }
  } catch {
    // expo-haptics not installed or unsupported on platform
  }
}

