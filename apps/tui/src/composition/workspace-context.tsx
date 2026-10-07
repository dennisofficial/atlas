import React, { useMemo } from 'react'
import type { ThreadId } from '@dltech/atlas-core'
import { createSessionContextReader, createSessionContextFolderStateStore, type ContextReader } from '@dltech/atlas-harness'

import { ContextViewer } from '../ui/components/context-viewer'
import { EContextView, useContextBrowser, type ContextControl } from './use-context'

export function useWorkspaceContext(args: {
  readers: ContextReader | undefined
  threadId: ThreadId
  onClosePeek: () => void
}): ContextControl {
  const readers = useMemo(() => args.readers ?? createSessionContextReader({ threadId: args.threadId }),
    [args.readers, args.threadId])
  const folderState = useMemo(() => createSessionContextFolderStateStore({ threadId: args.threadId }), [args.threadId])
  return useContextBrowser({ readers, folderState, onOpenFile: args.onClosePeek })
}

export function WorkspaceContextPane(props: { control: ContextControl; width: number }): React.ReactNode {
  const { viewer } = props.control
  if (viewer === null) return null
  return <ContextViewer key={viewer.path} width={props.width} path={viewer.path}
    loading={viewer.state === EContextView.Loading}
    content={viewer.state === EContextView.Ready ? viewer.content : null}
    onDismiss={props.control.handleDismiss} onNavigate={props.control.handleNavigate}
    attachScroll={props.control.attachScroll} />
}
