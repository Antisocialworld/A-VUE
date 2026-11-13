import React, { createContext, useContext } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useFonts } from 'expo-font';
import {
  RedHatDisplay_500Medium,
  RedHatDisplay_600SemiBold,
} from '@expo-google-fonts/red-hat-display';
import { Inter_500Medium } from '@expo-google-fonts/inter';
import { DarkColors } from '../tokens';

interface FontContextValue {
  fontsLoaded: boolean;
}

const FontContext = createContext<FontContextValue>({ fontsLoaded: false });

export const FontProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [fontsLoaded, fontError] = useFonts({
    'Red Hat Display': RedHatDisplay_500Medium,
    'Red Hat Display-Medium': RedHatDisplay_500Medium,
    'Red Hat Display-SemiBold': RedHatDisplay_600SemiBold,
    'RedHatDisplay-Medium': RedHatDisplay_500Medium,
    'RedHatDisplay-SemiBold': RedHatDisplay_600SemiBold,
    Inter: Inter_500Medium,
    'Inter-Medium': Inter_500Medium,
  });

  if (fontError) {
    return (
      <View
        style={styles.centerContainer}
        accessibilityRole="alert"
        accessibilityLabel={`Font loading failed: ${fontError.message}`}
      >
        <Text style={styles.errorText}>
          Failed to load application fonts. Please restart the application.
        </Text>
      </View>
    );
  }

  if (!fontsLoaded) {
    return (
      <View
        style={styles.centerContainer}
        accessibilityRole="progressbar"
        accessibilityLabel="Loading application fonts"
      >
        <ActivityIndicator size="large" color={DarkColors.primary} />
      </View>
    );
  }

  return <FontContext.Provider value={{ fontsLoaded }}>{children}</FontContext.Provider>;
};

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: DarkColors.surface,
  },
  errorText: {
    color: DarkColors.on_surface,
    fontSize: 16,
    textAlign: 'center',
  },
});

export const useAppFonts = () => useContext(FontContext);
