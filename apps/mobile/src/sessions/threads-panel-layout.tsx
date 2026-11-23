import { useTheme } from '@dltech/atlas-ui-native'
import { router } from 'expo-router'
import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'

import { PANEL_WIDTH } from '../layout/pane-layout'
import { EThreadsLayout } from '../layout/posture'
import { usePosture } from '../layout/use-posture'
import type { ISessionEntry } from './session-groups'
import { ThreadsHome } from './threads-home'
import { ThreadsOverlayLayer } from './threads-overlay-layer'

export const ThreadsPanelLayout = ({
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
  const { threads } = usePosture()

  const handleOpen = (entry: ISessionEntry) => {
    router.setParams({ id: entry.id, title: entry.title })
    onCloseOverlay()
  }

  const list = <ThreadsHome activeId={sessionId} onOpen={handleOpen} />

  if (threads === EThreadsLayout.Panel) {
    return (
      <View style={styles.row}>
        <View style={[styles.panel, { borderColor: theme.border }]}>{list}</View>
        <View style={styles.fill}>{children}</View>
      </View>
    )
  }

  if (threads === EThreadsLayout.Overlay) {
    return (
      <View style={styles.fill}>
        {children}
        <ThreadsOverlayLayer open={overlayOpen} onClose={onCloseOverlay}>
          {list}
        </ThreadsOverlayLayer>
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
