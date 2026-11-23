import React from 'react'

import { NoticeStack } from '../ui/components/notice-stack'
import { Threads } from '../ui/components/threads'
import type { SessionListControl } from './use-session-list'

export function SessionsScreen(props: {
  width: number
  list: SessionListControl
  onDismiss: () => void
}): React.ReactNode {
  return (
    <>
      <box flexGrow={1} />
      <Threads
        width={props.width}
        state={props.list.state}
        onPick={props.list.handlePick}
        onDismiss={props.onDismiss}
        onQueryChange={props.list.handleQuery}
      />
      <NoticeStack width={props.width} />
    </>
  )
}
