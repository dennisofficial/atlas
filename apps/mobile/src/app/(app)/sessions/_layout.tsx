import { useTheme } from '@dltech/atlas-ui-native'
import { Stack } from 'expo-router'

import { SessionsDrawer } from '../../../sessions/sessions-drawer'

const SessionsStack = () => {
  const theme = useTheme()
  return (
    <Stack
      screenOptions={{
        animation: 'none',
        gestureEnabled: false,
        contentStyle: { backgroundColor: theme.background },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[id]" options={{ title: '' }} />
    </Stack>
  )
}

export default function SessionsLayout() {
  return (
    <SessionsDrawer>
      <SessionsStack />
    </SessionsDrawer>
  )
}
