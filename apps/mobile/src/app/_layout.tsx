import { useIsDark, useTheme } from '@dltech/atlas-ui-native'
import { useFonts } from 'expo-font'
import { router, Stack, ThemeProvider } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { StyleSheet } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'

import { AnalyticsProvider } from '../analytics/analytics-provider'
import { AuthProvider, useAuth } from '../auth/auth-provider'
import { EAuthState } from '../auth/auth-reducer'
import {
  installNotificationHandler,
  subscribeToNotificationResponses,
} from '../push/notification-handler'
import { SplashOverlay } from '../splash/splash-overlay'
import { fontAssets } from '../theme/fonts'
import { navigationThemeOf } from '../theme/navigation-theme'

installNotificationHandler()
void SplashScreen.preventAutoHideAsync()

const RootStack = ({ fontsReady }: { fontsReady: boolean }) => {
  const { state } = useAuth()
  const signedIn = state === EAuthState.SignedIn
  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
        <Stack.Screen name="auth/callback" options={{ presentation: 'modal' }} />
      </Stack>
      <SplashOverlay ready={fontsReady && state !== EAuthState.Loading} />
    </>
  )
}

export default function RootLayout() {
  const theme = useTheme()
  const dark = useIsDark()
  const [fontsLoaded, fontError] = useFonts(fontAssets)
  useEffect(() => {
    const subscription = subscribeToNotificationResponses({
      onThreadId: (id) => router.push({ pathname: '/thread/[id]', params: { id } }),
    })
    return () => subscription.remove()
  }, [])
  return (
    <GestureHandlerRootView style={styles.root}>
      <AnalyticsProvider>
        <ThemeProvider value={navigationThemeOf({ theme, dark })}>
          <AuthProvider>
            <RootStack fontsReady={fontsLoaded || fontError !== null} />
            <StatusBar style={dark ? 'light' : 'dark'} />
          </AuthProvider>
        </ThemeProvider>
      </AnalyticsProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
})
