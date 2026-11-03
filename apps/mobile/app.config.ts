import type { ExpoConfig } from 'expo/config'

const EAS_PROJECT_ID = 'caf9803f-fa40-4b47-a9be-775097e17d0a'

export default (): ExpoConfig => ({
  name: 'Atlas',
  slug: 'atlas',
  owner: 'dennisofficial',
  version: '1.0.0',
  platforms: ['ios', 'web'],
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'atlas',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: 'io.byatlas.atlas',
    appleTeamId: '9H7HK25CVR',
    config: { usesNonExemptEncryption: false },
    supportsTablet: true,
    usesAppleSignIn: true,
  },
  web: {
    output: 'single',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-notifications',
    'expo-apple-authentication',
    'expo-web-browser',
    'posthog-react-native/expo',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#fbf7f2',
        image: './assets/images/splash-icon.png',
        imageWidth: 120,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  runtimeVersion: { policy: 'fingerprint' },
  updates: { url: `https://u.expo.dev/${EAS_PROJECT_ID}` },
  extra: {
    eas: { projectId: EAS_PROJECT_ID },
    apiOrigin: process.env.EXPO_PUBLIC_API_ORIGIN ?? 'https://api.byatlas.io',
    webOrigin: process.env.EXPO_PUBLIC_WEB_ORIGIN ?? 'https://byatlas.io',
  },
})
