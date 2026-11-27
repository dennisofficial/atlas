import { useTheme } from '@dltech/atlas-ui-native'
import { Stack } from 'expo-router'
import { useWindowDimensions } from 'react-native'

import { SideInsetFrame } from '../layout/side-inset-frame'
import { tabHeaderOptionsOf } from './header-options'

export const TabRootStack = ({ title }: { title: string }) => {
  const theme = useTheme()
  const { width: windowWidth } = useWindowDimensions()
  return (
    <Stack
      screenOptions={{ contentStyle: { backgroundColor: theme.sidebar } }}
      screenLayout={SideInsetFrame}
    >
      <Stack.Screen
        name="index"
        options={{ ...tabHeaderOptionsOf({ title, windowWidth }), animation: 'none' }}
      />
    </Stack>
  )
}
