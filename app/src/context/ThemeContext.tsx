import React, { createContext, useContext, useMemo, useState, useEffect } from 'react';
import { useColorScheme } from 'react-native';
import {
  ColorTokens,
  DarkColors,
  LightColors,
  Radius,
  Shadows,
  Spacing,
  ThemeMode,
  Typography,
} from '../tokens';

interface ThemeContextValue {
  mode: ThemeMode;
  colors: ColorTokens;
  spacing: typeof Spacing;
  radius: typeof Radius;
  shadows: typeof Shadows;
  typography: typeof Typography;
  setMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const ThemeProvider: React.FC<{
  initialMode?: ThemeMode;
  children: React.ReactNode;
}> = ({ initialMode, children }) => {
  const systemScheme = useColorScheme();
  const [mode, setMode] = useState<ThemeMode>(
    initialMode || (systemScheme === 'dark' ? 'dark' : 'light'),
  );

  useEffect(() => {
    if (!initialMode && systemScheme) {
      setMode(systemScheme === 'dark' ? 'dark' : 'light');
    }
  }, [systemScheme, initialMode]);

  const toggleTheme = () => {
    setMode((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  const colors = useMemo(() => (mode === 'dark' ? DarkColors : LightColors), [mode]);

  const value = useMemo(
    () => ({
      mode,
      colors,
      spacing: Spacing,
      radius: Radius,
      shadows: Shadows,
      typography: Typography,
      setMode,
      toggleTheme,
    }),
    [mode, colors],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeContextValue => {
  const context = useContext(ThemeContext);
  if (!context) {
    // Graceful fallback to Light tokens if accessed outside provider
    return {
      mode: 'light',
      colors: LightColors,
      spacing: Spacing,
      radius: Radius,
      shadows: Shadows,
      typography: Typography,
      setMode: () => {},
      toggleTheme: () => {},
    };
  }
  return context;
};

