import { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * A VUE Dynamic Expo Configuration
 * Adds cleartext HTTP permissions for Android dev builds ONLY when EXPO_PUBLIC_API_URL starts with http://.
 * Production remains HTTPS only.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL || '';
  const isPlainHttp = apiUrl.startsWith('http://');

  const plugins: any[] = config.plugins ? [...config.plugins] : ['expo-font'];

  if (isPlainHttp) {
    plugins.push([
      'expo-build-properties',
      {
        android: {
          usesCleartextTraffic: true,
        },
      },
    ]);
  }

  return {
    ...config,
    name: 'A VUE',
    slug: 'avue',
    description: 'A cinema ticket booking app. A view. Your view. Our view.',
    version: config.version || '1.0.0',
    orientation: config.orientation || 'portrait',
    userInterfaceStyle: config.userInterfaceStyle || 'automatic',
    icon: config.icon || './assets/logo/a-vue-icon-1024.png',
    web: config.web ?? { bundler: 'metro', output: 'single' },
    android: {
      ...config.android,
      package: 'app.avuemovies',
      adaptiveIcon: {
        foregroundImage: './assets/logo/a-vue-logo-dark.png',
        backgroundColor: '#1A110F',
      },
    },
    plugins,
  };
};

