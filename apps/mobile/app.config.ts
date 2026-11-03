import type { ExpoConfig } from 'expo/config'

const easProjectId = process.env.EAS_PROJECT_ID

export default (): ExpoConfig => ({
  name: 'Atlas',
  slug: 'atlas',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'atlas',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: 'io.byatlas.atlas',
    supportsTablet: true,
    usesAppleSignIn: true,
    icon: './assets/expo.icon',
  },
  android: {
    adaptiveIcon: {
      backgroundColor: '#1e1a17',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    output: 'server',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-notifications',
    'expo-apple-authentication',
    'expo-web-browser',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#1e1a17',
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  runtimeVersion: { policy: 'appVersion' },
  ...(easProjectId === undefined ? {} : { updates: { url: `https://u.expo.dev/${easProjectId}` } }),
  extra: {
    ...(easProjectId === undefined ? {} : { eas: { projectId: easProjectId } }),
    apiOrigin: process.env.EXPO_PUBLIC_API_ORIGIN ?? 'https://api.byatlas.io',
    webOrigin: process.env.EXPO_PUBLIC_WEB_ORIGIN ?? 'https://byatlas.io',
  },
})
