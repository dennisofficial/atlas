import { PauseIcon, PlayIcon, RotateCwIcon, UnplugIcon } from 'lucide-react'

import { Button } from '#components/button'
import { Notice } from './notice'
import { InlineSpinner, StatusDot, EStatusTone } from './internal/status-dot'

export enum ETerminalConnection {
  Connecting = 'connecting',
  Connected = 'connected',
  Paused = 'paused',
  Disconnected = 'disconnected',
}

export const DEFAULT_NOUN = 'pod'

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

interface HeaderInput {
  connection: ETerminalConnection
  noun: string
  detail?: string
}

function suffixOf(detail?: string): string {
  return detail ? ` · ${detail}` : ''
}

export function connectionLabel({ connection, noun, detail }: HeaderInput): string {
  if (connection === ETerminalConnection.Connecting) return `Connecting to ${noun}…`
  if (connection === ETerminalConnection.Connected) {
    return `Connected to ${noun}${suffixOf(detail)}`
  }
  if (connection === ETerminalConnection.Paused) {
    return `${capitalise(noun)} paused${suffixOf(detail)}`
  }
  return `Disconnected from ${noun}`
}

const CONNECTION_TONE: Record<ETerminalConnection, EStatusTone | undefined> = {
  [ETerminalConnection.Connecting]: undefined,
  [ETerminalConnection.Connected]: EStatusTone.Live,
  [ETerminalConnection.Paused]: EStatusTone.Pending,
  [ETerminalConnection.Disconnected]: EStatusTone.Error,
}

export interface ConnectionHeaderProps {
  connection: ETerminalConnection
  noun?: string
  detail?: string
}

export function ConnectionHeader({
  connection,
  noun = DEFAULT_NOUN,
  detail,
}: ConnectionHeaderProps) {
  const tone = CONNECTION_TONE[connection]

  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3 text-xs text-muted-foreground">
      {tone ? <StatusDot tone={tone} /> : <InlineSpinner />}
      <span>{connectionLabel({ connection, noun, detail })}</span>
    </div>
  )
}

export function ConnectingNotice({ noun = DEFAULT_NOUN }: { noun?: string }) {
  return (
    <Notice
      icon={<InlineSpinner />}
      title="Opening a shell"
      description={`Starting a login shell in this thread's ${noun}.`}
    />
  )
}

export function PausedNotice({ onResume }: { onResume: () => void }) {
  return (
    <Notice
      icon={<PauseIcon />}
      title="Pod paused"
      description="It paused after 30 minutes without activity. Files and terminals come back when it resumes."
      action={
        <Button size="sm" onClick={onResume}>
          <PlayIcon data-icon="inline-start" />
          Resume pod
        </Button>
      }
    />
  )
}

export interface DisconnectedBarProps {
  onReconnect: () => void
  message?: string
}

export function DisconnectedBar({
  onReconnect,
  message = 'Connection lost. Scrollback is kept.',
}: DisconnectedBarProps) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <UnplugIcon className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{message}</span>
      <Button size="xs" variant="outline" onClick={onReconnect}>
        <RotateCwIcon data-icon="inline-start" />
        Reconnect
      </Button>
    </div>
  )
}
