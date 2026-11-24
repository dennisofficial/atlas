import { EFontWeight, ETextRole, Text, useTheme } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { usePathname } from 'expo-router'
import type { ReactNode } from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import { Drawer } from 'react-native-drawer-layout'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { EControlsPlacement } from '../layout/posture'
import { usePosture } from '../layout/use-posture'
import { AccountButton } from '../navigation/account-button'
import { applyNavigation } from '../navigation/apply-navigation'
import { NewSessionButton } from '../navigation/new-session-button'
import { sessionOpenOf } from '../navigation/root-navigation'
import { drawerGeometryOf } from './drawer-layout'
import type { ISessionEntry } from './session-groups'
import { useSelectedSession } from './selected-session'
import { useSessionsDrawer } from './sessions-drawer-state'
import { SessionsList } from './sessions-list'

const DRAWER_EDGE_WIDTH = 40

const SessionsDrawerContent = ({
  paddingTop,
  onOpenSession,
}: {
  paddingTop: number
  onOpenSession: (entry: ISessionEntry) => void
}) => {
  const posture = usePosture()
  const selected = useSelectedSession()
  const showsAccount = posture.controls === EControlsPlacement.BottomBar
  return (
    <View style={[styles.content, { paddingTop: paddingTop + space(2) }]}>
      <View style={styles.header}>
        <Text
          size={ETextRole.Lg}
          weight={EFontWeight.Semibold}
          numberOfLines={1}
          style={styles.title}
        >
          Sessions
        </Text>
        <View style={styles.actions}>
          {showsAccount ? <AccountButton /> : null}
          <NewSessionButton />
        </View>
      </View>
      <View style={styles.list}>
        <SessionsList activeId={selected} onOpen={onOpenSession} />
      </View>
    </View>
  )
}

export const SessionsDrawer = ({ children }: { children: ReactNode }) => {
  const theme = useTheme()
  const posture = usePosture()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const pathname = usePathname()
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
      swipeEnabled={!geometry.permanent}
      swipeEdgeWidth={DRAWER_EDGE_WIDTH}
      overlayAccessibilityLabel="Close sessions"
      drawerStyle={{
        backgroundColor: theme.sidebar,
        borderRightColor: theme.border,
        borderRightWidth: geometry.permanent ? StyleSheet.hairlineWidth : 0,
        width: geometry.width,
      }}
      renderDrawerContent={() => (
        <SessionsDrawerContent paddingTop={insets.top} onOpenSession={handleOpenSession} />
      )}
    >
      {children}
    </Drawer>
  )
}

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(1),
  },
  content: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(2),
    paddingBottom: space(2),
    paddingHorizontal: space(2),
  },
  list: {
    flex: 1,
  },
  title: {
    flex: 1,
  },
})
