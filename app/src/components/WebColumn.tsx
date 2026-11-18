import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { WEB_CONTENT_MAX_WIDTH } from '../utils/webLayout';

/** Shared web-only centred column. Native renders children with no wrapper. */
export const WebColumn: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  if (Platform.OS !== 'web') {
    return <>{children}</>;
  }

  return <View style={styles.column}>{children}</View>;
};

const styles = StyleSheet.create({
  column: {
    flex: 1,
    width: '100%',
    maxWidth: WEB_CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },
});
