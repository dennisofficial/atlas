import { useIsDark, useTheme } from '@dltech/atlas-ui-native'
import { useFonts } from 'expo-font'
import * as Linking from 'expo-linking'
import { router, Stack, ThemeProvider } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useRef, useState } from 'react'
import { StyleSheet } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'

import { AnalyticsProvider } from '../analytics/analytics-provider'
import { AuthProvider, useAuth } from '../auth/auth-provider'
import { EAuthState } from '../auth/auth-reducer'
import { destinationOfUrl, type TDestination } from '../navigation/destination'
import {
  installNotificationHandler,
  subscribeToNotificationResponses,
} from '../push/notification-handler'
import { SettingsProvider } from '../settings/settings-provider'
import { SplashOverlay } from '../splash/splash-overlay'
import { fontAssets } from '../theme/fonts'
import { navigationThemeOf } from '../theme/navigation-theme'
import { installWebReset } from '../theme/web-reset'
import { UpdateCard } from '../updates/update-card'

installNotificationHandler()
installWebReset()
void SplashScreen.preventAutoHideAsync()

const pushAfterGuardSettles = (destination: TDestination): void => {
  setTimeout(() => router.push(destination), 0)
}

const RootStack = ({ fontsReady }: { fontsReady: boolean }) => {
  const { state } = useAuth()
  const [incoming, setIncoming] = useState<TDestination | undefined>(undefined)
  const [launchUrl] = useState(() => Linking.getInitialURL())
  const launchRead = useRef(false)
  const replaying = useRef<TDestination | undefined>(undefined)
  const signedIn = state === EAuthState.SignedIn
  const settled = state !== EAuthState.Loading

  useEffect(() => {
    const subscription = subscribeToNotificationResponses({
      onThreadId: (id) => setIncoming({ pathname: '/thread/[id]', params: { id } }),
    })
    return () => subscription.remove()
  }, [])

  useEffect(() => {
    if (state !== EAuthState.SignedOut || launchRead.current) return
    launchRead.current = true
    void launchUrl.then((url) => {
      const destination = destinationOfUrl(url)
      if (destination !== undefined) setIncoming((current) => current ?? destination)
    })
  }, [state, launchUrl])

  useEffect(() => {
    if (!signedIn || incoming === undefined || replaying.current === incoming) return
    replaying.current = incoming
    setIncoming(undefined)
    pushAfterGuardSettles(incoming)
  }, [incoming, signedIn])

  return (
    <>
      {settled ? (
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="(app)" />
          </Stack.Protected>
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="sign-in" />
          </Stack.Protected>
          <Stack.Screen name="auth/callback" options={{ presentation: 'modal' }} />
        </Stack>
      ) : null}
      <UpdateCard />
      <SplashOverlay ready={fontsReady && settled} />
    </>
  )
}

export default function RootLayout() {
  const theme = useTheme()
  const dark = useIsDark()
  const [fontsLoaded, fontError] = useFonts(fontAssets)
  return (
    <GestureHandlerRootView style={styles.root}>
      <AnalyticsProvider>
        <ThemeProvider value={navigationThemeOf({ theme, dark })}>
          <AuthProvider>
            <SettingsProvider>
              <RootStack fontsReady={fontsLoaded || fontError !== null} />
              <StatusBar style={dark ? 'light' : 'dark'} />
            </SettingsProvider>
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
