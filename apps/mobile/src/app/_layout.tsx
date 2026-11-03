import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { useColorScheme } from 'react-native'

import { AuthProvider, useAuth } from '../auth/auth-provider'
import { EAuthState } from '../auth/auth-reducer'
import {
  installNotificationHandler,
  subscribeToNotificationResponses,
} from '../push/notification-handler'

installNotificationHandler()

const RootStack = () => {
  const { state } = useAuth()
  const signedIn = state === EAuthState.SignedIn
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Screen name="auth/callback" options={{ presentation: 'modal' }} />
    </Stack>
  )
}

export default function RootLayout() {
  const colorScheme = useColorScheme()
  useEffect(() => {
    const subscription = subscribeToNotificationResponses({
      onThreadId: (threadId) => console.log(`[push] tapped notification for thread ${threadId}`),
    })
    return () => subscription.remove()
  }, [])
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <RootStack />
        <StatusBar style="auto" />
      </AuthProvider>
    </ThemeProvider>
  )
}
