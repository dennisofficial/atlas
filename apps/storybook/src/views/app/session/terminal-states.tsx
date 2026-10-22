import type { ReactNode } from 'react'
import { PauseIcon, PlayIcon, RotateCwIcon, UnplugIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Spinner } from '@dltech/atlas-ui/components/spinner'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { ETerminalConnection, SANDBOX } from './sandbox-terminal'

export const DEFAULT_NOUN = 'pod'

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function headerOf({ connection, noun }: { connection: ETerminalConnection; noun: string }) {
  const headers: Record<ETerminalConnection, { label: string; dot: string }> = {
    [ETerminalConnection.Connecting]: { label: `Connecting to ${noun}…`, dot: '' },
    [ETerminalConnection.Connected]: {
      label: `Connected to ${noun} · ${SANDBOX.size}`,
      dot: 'bg-success',
    },
    [ETerminalConnection.Paused]: {
      label: `${capitalise(noun)} paused · ${SANDBOX.size}`,
      dot: 'bg-warning',
    },
    [ETerminalConnection.Disconnected]: {
      label: `Disconnected from ${noun}`,
      dot: 'bg-destructive',
    },
  }
  return headers[connection]
}

export function ConnectionHeader({
  connection,
  noun = DEFAULT_NOUN,
}: {
  connection: ETerminalConnection
  noun?: string
}) {
  const { label, dot } = headerOf({ connection, noun })

  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3 text-xs text-muted-foreground">
      {connection === ETerminalConnection.Connecting ? (
        <Spinner className="size-3" />
      ) : (
        <span aria-hidden className={cn('size-1.5 rounded-full', dot)} />
      )}
      <span>{label}</span>
    </div>
  )
}

interface NoticeProps {
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
}

export function Notice({ icon, title, description, action }: NoticeProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="flex size-9 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground [&_svg]:size-4">
        {icon}
      </div>
      <div className="flex max-w-64 flex-col gap-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  )
}

export function ConnectingNotice({ noun = DEFAULT_NOUN }: { noun?: string }) {
  return (
    <Notice
      icon={<Spinner />}
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
      description="It paused after 15 minutes without activity. Files and terminals come back when it resumes."
      action={
        <Button size="sm" onClick={onResume}>
          <PlayIcon data-icon="inline-start" />
          Resume pod
        </Button>
      }
    />
  )
}

interface DisconnectedBarProps {
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
