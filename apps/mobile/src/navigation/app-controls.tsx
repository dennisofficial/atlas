import { usePathname } from 'expo-router'
import { StyleSheet, View } from 'react-native'

import { EControlsPlacement } from '../layout/posture'
import { usePosture } from '../layout/use-posture'
import { useSessionsDrawer } from '../sessions/sessions-drawer-state'
import { BottomTabBar } from './bottom-tab-bar'
import { ControlRail } from './control-rail'
import { bottomBarVisibleOf } from './root-navigation'

export const AppControls = () => {
  const posture = usePosture()
  const pathname = usePathname()
  const { open } = useSessionsDrawer()
  const rail = posture.controls === EControlsPlacement.Rail
  const bottomBar = !rail && bottomBarVisibleOf({ pathname, drawerOpen: open })
  if (!rail && !bottomBar) return null
  return (
    <View style={styles.root} pointerEvents="box-none">
      {rail ? <ControlRail /> : <BottomTabBar />}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
})
