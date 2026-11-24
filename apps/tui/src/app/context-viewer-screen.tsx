import type { ScrollBoxRenderable } from '@opentui/core'
import React from 'react'

import type { FileContent } from '@dltech/atlas-protocol'

import { ContextViewer } from '../ui/components/context-viewer'
import { theme } from '../ui/theme'

const VIEWER_Z = 25

export function ContextViewerScreen(props: {
  width: number
  path: string
  loading: boolean
  content: FileContent | null
  openUrl: (url: string) => void
  onDismiss: () => void
  attachScroll: (box: ScrollBoxRenderable | null) => void
}): React.ReactNode {
  return (
    <box
      flexDirection="column"
      position="absolute"
      zIndex={VIEWER_Z}
      top={0}
      bottom={0}
      left={0}
      right={0}
      width={props.width}
      backgroundColor={theme.overlayBg}
    >
      <ContextViewer
        key={props.path}
        width={props.width}
        path={props.path}
        loading={props.loading}
        content={props.content}
        openUrl={props.openUrl}
        onDismiss={props.onDismiss}
        attachScroll={props.attachScroll}
      />
    </box>
  )
}
