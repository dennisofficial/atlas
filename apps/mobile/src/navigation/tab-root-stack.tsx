import { useTheme } from '@dltech/atlas-ui-native'
import { Stack } from 'expo-router'

import { SideInsetFrame } from '../layout/side-inset-frame'
import { useContentWidth } from '../layout/use-content-width'
import { tabHeaderOptionsOf } from './header-options'

export const TabRootStack = ({
  title,
  offersNewSession = true,
}: {
  title: string
  offersNewSession?: boolean
}) => {
  const theme = useTheme()
  const contentWidth = useContentWidth()
  return (
    <SideInsetFrame background={theme.sidebar}>
      <Stack screenOptions={{ contentStyle: { backgroundColor: theme.sidebar } }}>
        <Stack.Screen
          name="index"
          options={{
            ...tabHeaderOptionsOf({ title, barWidth: contentWidth, offersNewSession }),
            animation: 'none',
          }}
        />
      </Stack>
    </SideInsetFrame>
  )
}
