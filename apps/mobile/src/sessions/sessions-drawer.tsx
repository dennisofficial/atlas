import { useTheme } from '@dltech/atlas-ui-native'
import { usePathname } from 'expo-router'
import type { ReactNode } from 'react'
import { StyleSheet, useWindowDimensions } from 'react-native'
import { Drawer } from 'react-native-drawer-layout'

import { usePosture } from '../layout/use-posture'
import { applyNavigation } from '../navigation/apply-navigation'
import { sessionOpenOf } from '../navigation/root-navigation'
import { drawerGeometryOf, drawerSwipeEnabledOf } from './drawer-layout'
import { DRAWER_PAN, tuneDrawerPan } from './drawer-pan'
import type { ISessionEntry } from './session-groups'
import { useSelectedSession } from './selected-session'
import { SessionsDrawerShell } from './sessions-drawer-shell'
import { useSessionsDrawer } from './sessions-drawer-state'

export const SessionsDrawer = ({ children }: { children: ReactNode }) => {
  const theme = useTheme()
  const posture = usePosture()
  const { width } = useWindowDimensions()
  const pathname = usePathname()
  const selected = useSelectedSession()
  const { open, setOpen } = useSessionsDrawer()
  const geometry = drawerGeometryOf({ listLayout: posture.sessionsList, width })

  const handleOpen = () => setOpen(true)
  const handleClose = () => setOpen(false)

  const handleOpenSession = (entry: ISessionEntry) => {
    if (!geometry.permanent) setOpen(false)
    applyNavigation(sessionOpenOf({ pathname, id: entry.id }))
  }

  return (
    <Drawer
      open={geometry.permanent || open}
      onOpen={handleOpen}
      onClose={handleClose}
      drawerType={geometry.permanent ? 'permanent' : 'front'}
      swipeEnabled={drawerSwipeEnabledOf({ geometry, open })}
      swipeEdgeWidth={DRAWER_PAN.edgeWidth}
      swipeMinDistance={DRAWER_PAN.minDistance}
      configureGestureHandler={tuneDrawerPan}
      overlayAccessibilityLabel="Close sessions"
      drawerStyle={{
        backgroundColor: theme.sidebar,
        borderRightColor: theme.border,
        borderRightWidth: geometry.permanent ? StyleSheet.hairlineWidth : 0,
        width: geometry.width,
      }}
      renderDrawerContent={() => (
        <SessionsDrawerShell activeId={selected} onOpen={handleOpenSession} />
      )}
    >
      {children}
    </Drawer>
  )
}
