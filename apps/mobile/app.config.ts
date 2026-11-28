import type { ExpoConfig } from 'expo/config'

const EAS_PROJECT_ID = '16cd56e9-a0b0-4b22-b6d2-960163c726e6'

export default (): ExpoConfig => ({
  name: 'Atlas',
  slug: 'atlas',
  owner: 'comp-ai',
  version: '1.0.0',
  platforms: ['ios', 'web'],
  orientation: 'default',
  icon: './assets/images/icon.png',
  scheme: 'atlas',
  userInterfaceStyle: 'automatic',
  ios: {
    icon: {
      light: './assets/images/icon.png',
      dark: './assets/images/icon-dark.png',
    },
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
    ['expo-notifications', { enableBackgroundRemoteNotifications: true }],
    'expo-apple-authentication',
    'expo-web-browser',
    'expo-document-picker',
    [
      'expo-image-picker',
      {
        photosPermission: 'Atlas reads the photos you choose so you can send them to your agent.',
        cameraPermission: 'Atlas uses the camera only when you take a photo to send.',
      },
    ],
    [
      'expo-audio',
      {
        microphonePermission:
          'Atlas uses the microphone to turn your speech into text in the composer.',
      },
    ],
    'posthog-react-native/expo',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#f9f9f9',
        image: './assets/images/splash-mark-light.png',
        imageWidth: 120,
        dark: {
          backgroundColor: '#1b1b1b',
          image: './assets/images/splash-mark-dark.png',
        },
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
