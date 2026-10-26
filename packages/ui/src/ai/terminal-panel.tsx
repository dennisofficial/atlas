import type { ReactNode } from 'react'

import {
  ConnectingNotice,
  ConnectionHeader,
  DisconnectedBar,
  ETerminalConnection,
  PausedNotice,
} from './terminal-states'
import { TerminalTabs, type TerminalTab } from './terminal-tabs'

export interface TerminalPanelProps {
  connection: ETerminalConnection
  tabs: TerminalTab[]
  activeId: string
  onActiveChange: (id: string) => void
  onNew?: () => void
  onReconnect: () => void
  noun?: string
  detail?: string
  disconnectedMessage?: string
  children: ReactNode
}

export function TerminalPanel({
  connection,
  tabs,
  activeId,
  onActiveChange,
  onNew,
  onReconnect,
  noun,
  detail,
  disconnectedMessage,
  children,
}: TerminalPanelProps) {
  const showScreen =
    connection === ETerminalConnection.Connected || connection === ETerminalConnection.Disconnected

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <ConnectionHeader connection={connection} noun={noun} detail={detail} />
      <TerminalTabs tabs={tabs} activeId={activeId} onActiveChange={onActiveChange} onNew={onNew} />
      {connection === ETerminalConnection.Connecting ? <ConnectingNotice noun={noun} /> : null}
      {connection === ETerminalConnection.Paused ? <PausedNotice onResume={onReconnect} /> : null}
      {showScreen ? children : null}
      {connection === ETerminalConnection.Disconnected ? (
        <DisconnectedBar onReconnect={onReconnect} message={disconnectedMessage} />
      ) : null}
    </div>
  )
}
