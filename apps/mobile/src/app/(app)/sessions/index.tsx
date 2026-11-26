import { Button, EButtonSize, EButtonVariant, useTheme } from '@dltech/atlas-ui-native'
import { Image } from 'expo-image'
import { router, Stack, useFocusEffect } from 'expo-router'
import { PanelLeft } from 'lucide-react-native'
import { useCallback, useEffect } from 'react'
import { Platform, StyleSheet, View } from 'react-native'

import { usePosture } from '../../../layout/use-posture'
import { EHeaderLeadingItem, sessionHeaderLeadingOf } from '../../../navigation/header-leading'
import { newSessionHeaderItemOf } from '../../../navigation/header-options'
import { NewSessionButton } from '../../../navigation/new-session-button'
import { sessionsTabHrefOf } from '../../../navigation/root-navigation'
import { SessionsButton } from '../../../navigation/sessions-button'
import { opensDrawerWithoutSessionOf } from '../../../sessions/drawer-layout'
import { useSelectedSession, useSelectedSessionLoaded } from '../../../sessions/selected-session'
import { useSessionsDrawer } from '../../../sessions/sessions-drawer-state'

const MARK_WIDTH = 96
const MARK_ASPECT = 1024 / 830
const mark = require('../../../../assets/images/splash-mark.png')

export default function SessionsIndexScreen() {
  const theme = useTheme()
  const selected = useSelectedSession()
  const loaded = useSelectedSessionLoaded()
  const posture = usePosture()
  const { setOpen } = useSessionsDrawer()
  const showsSessions = sessionHeaderLeadingOf({ posture }).includes(EHeaderLeadingItem.Sessions)
  const handleOpenSessions = useCallback(() => setOpen(true), [setOpen])

  useEffect(() => {
    if (!loaded || selected === null) return
    router.replace(sessionsTabHrefOf({ selected }))
  }, [loaded, selected])

  useFocusEffect(
    useCallback(() => {
      if (!loaded) return
      if (!opensDrawerWithoutSessionOf({ listLayout: posture.sessionsList, selected })) return
      setOpen(true)
    }, [loaded, selected, posture.sessionsList, setOpen]),
  )

  return (
    <View style={[styles.screen, { backgroundColor: theme.sidebar }]}>
      <Stack.Screen
        options={{
          unstable_headerLeftItems: () =>
            showsSessions
              ? [
                  {
                    type: 'custom',
                    element: <SessionsButton onPress={handleOpenSessions} />,
                    hidesSharedBackground: false,
                  },
                ]
              : [],
          unstable_headerRightItems: () =>
            Platform.OS === 'ios' ? [newSessionHeaderItemOf()] : [],
          headerLeft:
            showsSessions && Platform.OS !== 'ios'
              ? () => (
                  <Button
                    label="Sessions"
                    icon={PanelLeft}
                    variant={EButtonVariant.Ghost}
                    size={EButtonSize.IconLg}
                    onPress={handleOpenSessions}
                  />
                )
              : undefined,
          headerRight: Platform.OS === 'ios' ? undefined : () => <NewSessionButton />,
        }}
      />
      <Image source={mark} style={styles.mark} contentFit="contain" accessibilityLabel="Atlas" />
    </View>
  )
}

const styles = StyleSheet.create({
  mark: {
    height: MARK_WIDTH / MARK_ASPECT,
    width: MARK_WIDTH,
  },
  screen: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
})
