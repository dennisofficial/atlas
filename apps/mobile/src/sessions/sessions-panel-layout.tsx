import { useTheme } from '@dltech/atlas-ui-native'
import { router } from 'expo-router'
import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'

import { PANEL_WIDTH } from '../layout/pane-layout'
import { ESessionsLayout } from '../layout/posture'
import { usePosture } from '../layout/use-posture'
import type { ISessionEntry } from './session-groups'
import { SessionsHome } from './sessions-home'
import { SessionsOverlayLayer } from './sessions-overlay-layer'

export const SessionsPanelLayout = ({
  sessionId,
  overlayOpen,
  onCloseOverlay,
  children,
}: {
  sessionId: string
  overlayOpen: boolean
  onCloseOverlay: () => void
  children: ReactNode
}) => {
  const theme = useTheme()
  const { sessions } = usePosture()

  const handleOpen = (entry: ISessionEntry) => {
    router.setParams({ id: entry.id, title: entry.title })
    onCloseOverlay()
  }

  const list = <SessionsHome activeId={sessionId} onOpen={handleOpen} />

  if (sessions === ESessionsLayout.Panel) {
    return (
      <View style={styles.row}>
        <View style={[styles.panel, { borderColor: theme.border }]}>{list}</View>
        <View style={styles.fill}>{children}</View>
      </View>
    )
  }

  if (sessions === ESessionsLayout.Overlay) {
    return (
      <View style={styles.fill}>
        {children}
        <SessionsOverlayLayer open={overlayOpen} onClose={onCloseOverlay}>
          {list}
        </SessionsOverlayLayer>
      </View>
    )
  }

  return <View style={styles.fill}>{children}</View>
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
  },
  panel: {
    borderRightWidth: StyleSheet.hairlineWidth,
    width: PANEL_WIDTH,
  },
})
