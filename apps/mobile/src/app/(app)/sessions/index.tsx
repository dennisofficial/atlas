import { useTheme } from '@dltech/atlas-ui-native'
import { Image } from 'expo-image'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'

import { sessionsTabHrefOf } from '../../../navigation/root-navigation'
import { useSelectedSession, useSelectedSessionLoaded } from '../../../sessions/selected-session'
import { useSessionsDrawer } from '../../../sessions/sessions-drawer-state'

const MARK_WIDTH = 96
const MARK_ASPECT = 1024 / 830
const mark = require('../../../../assets/images/splash-mark.png')

export default function SessionsIndexScreen() {
  const theme = useTheme()
  const selected = useSelectedSession()
  const loaded = useSelectedSessionLoaded()
  const { setOpen } = useSessionsDrawer()

  useEffect(() => {
    if (!loaded || selected === null) return
    router.replace(sessionsTabHrefOf({ selected }))
  }, [loaded, selected])

  useFocusEffect(
    useCallback(() => {
      if (!loaded || selected !== null) return
      setOpen(true)
    }, [loaded, selected, setOpen]),
  )

  return (
    <View style={[styles.screen, { backgroundColor: theme.sidebar }]}>
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
