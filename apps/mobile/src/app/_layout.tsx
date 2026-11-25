import { useIsDark, useTheme } from '@dltech/atlas-ui-native'
import { useFonts } from 'expo-font'
import * as Linking from 'expo-linking'
import { ObserveRoot, useObserve } from 'expo-observe'
import { Stack, ThemeProvider, usePathname } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useRef, useState } from 'react'
import { StyleSheet } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'

import { AnalyticsIdentity } from '../analytics/analytics-identity'
import { AnalyticsProvider } from '../analytics/analytics-provider'
import { AuthProvider, useAuth } from '../auth/auth-provider'
import { EAuthState } from '../auth/auth-reducer'
import { CrashScreen } from '../errors/crash-screen'
import { applyNavigation } from '../navigation/apply-navigation'
import { destinationOfUrl, type TDestination } from '../navigation/destination'
import { sessionOpenOf } from '../navigation/root-navigation'
import { installBackgroundNotifications } from '../push/background-notifications'
import {
  installNotificationHandler,
  lastNotificationTap,
  subscribeToNotificationResponses,
} from '../push/notification-handler'
import { installNotificationCategory, reportNotificationResponse } from '../push/notification-track'
import { claimSessionTap, type TNotificationTap } from '../push/session-tap'
import { SettingsProvider } from '../settings/settings-provider'
import { SplashOverlay } from '../splash/splash-overlay'
import { fontAssets } from '../theme/fonts'
import { navigationThemeOf } from '../theme/navigation-theme'
import { installWebReset } from '../theme/web-reset'
import { UpdateCard } from '../updates/update-card'

export const ErrorBoundary = CrashScreen

installNotificationHandler()
void installNotificationCategory()
installBackgroundNotifications()
installWebReset()
void SplashScreen.preventAutoHideAsync()

const RootStack = ({ fontsReady }: { fontsReady: boolean }) => {
  const { state, api } = useAuth()
  const pathname = usePathname()
  const [incoming, setIncoming] = useState<TDestination | undefined>(undefined)
  const [launchUrl] = useState(() => Linking.getInitialURL())
  const launchRead = useRef(false)
  const replaying = useRef<TDestination | undefined>(undefined)
  const signedIn = state === EAuthState.SignedIn
  const settled = state !== EAuthState.Loading
  const { markInteractive } = useObserve()

  useEffect(() => {
    if (fontsReady && settled) markInteractive()
  }, [fontsReady, settled, markInteractive])

  useEffect(() => {
    const handled = new Set<string>()
    const route = (tap: TNotificationTap) => {
      void reportNotificationResponse({
        client: api,
        actionIdentifier: tap.actionIdentifier ?? '',
        data: tap.data,
      })
      const sessionId = claimSessionTap({ handled, tap })
      if (sessionId === undefined) return
      setIncoming((current) => current ?? { pathname: '/sessions/[id]', params: { id: sessionId } })
    }
    const subscription = subscribeToNotificationResponses({ onTap: route })
    const launch = lastNotificationTap()
    if (launch !== undefined) route(launch)
    return () => subscription.remove()
  }, [api])

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
    const id = incoming.params.id
    setTimeout(() => applyNavigation(sessionOpenOf({ pathname, id })), 0)
  }, [incoming, signedIn, pathname])

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

const RootLayout = () => {
  const theme = useTheme()
  const dark = useIsDark()
  const [fontsLoaded, fontError] = useFonts(fontAssets)
  return (
    <GestureHandlerRootView style={styles.root}>
      <AnalyticsProvider>
        <ThemeProvider value={navigationThemeOf({ theme, dark })}>
          <AuthProvider>
            <AnalyticsIdentity />
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

export default ObserveRoot.wrap(RootLayout)

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
})
