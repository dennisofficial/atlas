import { useTheme } from '@dltech/atlas-ui-native'
import { Stack } from 'expo-router'
import { useWindowDimensions } from 'react-native'

import { SideInsetFrame } from '../layout/side-inset-frame'
import { tabHeaderOptionsOf } from './header-options'

export const TabRootStack = ({
  title,
  offersNewSession = true,
}: {
  title: string
  offersNewSession?: boolean
}) => {
  const theme = useTheme()
  const { width: windowWidth } = useWindowDimensions()
  return (
    <Stack
      screenOptions={{ contentStyle: { backgroundColor: theme.sidebar } }}
      screenLayout={SideInsetFrame}
    >
      <Stack.Screen
        name="index"
        options={{
          ...tabHeaderOptionsOf({ title, windowWidth, offersNewSession }),
          animation: 'none',
        }}
      />
    </Stack>
  )
}
