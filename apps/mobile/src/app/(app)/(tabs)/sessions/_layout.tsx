import { useTheme } from '@dltech/atlas-ui-native'
import { Stack } from 'expo-router'

import { SideInsetFrame } from '../../../../layout/side-inset-frame'
import { barHeaderOptionsOf, usesGlassHeader } from '../../../../navigation/glass-header'
import { SessionsDrawer } from '../../../../sessions/sessions-drawer'

const SessionsStack = () => {
  const theme = useTheme()
  const glass = usesGlassHeader()
  return (
    <Stack
      screenOptions={{
        animation: 'none',
        gestureEnabled: false,
        contentStyle: { backgroundColor: theme.background },
      }}
      screenLayout={SideInsetFrame}
    >
      <Stack.Screen
        name="index"
        options={{
          title: '',
          headerShadowVisible: false,
          ...barHeaderOptionsOf({ glass, background: theme.sidebar, foreground: theme.foreground }),
        }}
      />
      <Stack.Screen
        name="[id]"
        options={{
          title: '',
          ...barHeaderOptionsOf({
            glass,
            background: theme.background,
            foreground: theme.foreground,
          }),
        }}
      />
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
