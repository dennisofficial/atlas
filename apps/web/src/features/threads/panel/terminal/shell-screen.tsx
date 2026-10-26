'use client'

import { useEffect, useRef } from 'react'

import {
  TerminalScreen,
  type TerminalScreenHandle,
  type TerminalSize,
} from '@dltech/atlas-ui/ai/terminal-screen'

import {
  ETerminalTabState,
  type TerminalSet,
  type TerminalSink,
  type TerminalTabView,
} from '../../data/terminal-session-set'

const DIMMED: ReadonlySet<ETerminalTabState> = new Set([
  ETerminalTabState.Ended,
  ETerminalTabState.Failed,
  ETerminalTabState.Suspended,
])

export type ShellScreenProps = {
  set: TerminalSet
  tab: TerminalTabView
}

export function ShellScreen({ set, tab }: ShellScreenProps) {
  const screen = useRef<TerminalScreenHandle>(null)
  const sink = useRef<TerminalSink>({
    write: (data) => screen.current?.write(data),
  })
  const { id } = tab

  useEffect(() => {
    const mounted = sink.current
    return () => set.detach({ id, sink: mounted })
  }, [set, id])

  const handleReady = (size: TerminalSize) => set.attach({ id, sink: sink.current, size })
  const handleResize = (size: TerminalSize) => set.resize({ id, size })
  const handleData = (data: string) => set.input({ id, data })

  return (
    <TerminalScreen
      ref={screen}
      label={`${tab.name} shell`}
      readOnly={tab.state !== ETerminalTabState.Open}
      dimmed={DIMMED.has(tab.state)}
      onReady={handleReady}
      onResize={handleResize}
      onData={handleData}
    />
  )
}
