import { PlusIcon, PlayIcon, TerminalIcon, UnplugIcon } from 'lucide-react'
import { useRef } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Notice } from '@dltech/atlas-ui/ai/notice'
import { TerminalScreen, type TerminalScreenHandle } from '@dltech/atlas-ui/ai/terminal-screen'

import { promptOf, scrollbackOf } from '../../terminal-ansi'
import { nextInputOf } from '../../terminal-ansi'
import { ETerminalEnd, type PaneTerminal } from './terminal-scenario'

export interface LiveShellProps {
  terminal: PaneTerminal
  className?: string
}

export function LiveShell({ terminal, className }: LiveShellProps) {
  const screen = useRef<TerminalScreenHandle>(null)
  const buffer = useRef('')
  const prompt = promptOf({ cwd: terminal.cwd, host: terminal.host })

  const handleReady = () => {
    screen.current?.write(scrollbackOf(terminal))
    screen.current?.write(prompt)
    screen.current?.focus()
  }

  const handleData = (data: string) => {
    const next = nextInputOf({ buffer: buffer.current, data })
    buffer.current = next.buffer
    screen.current?.write(next.echo)
    if (next.command !== undefined) screen.current?.write(prompt)
  }

  return (
    <TerminalScreen
      ref={screen}
      label={`${terminal.label} scrollback`}
      onReady={handleReady}
      onData={handleData}
      className={className}
    />
  )
}

function endedDescription(terminal: PaneTerminal): string {
  if (terminal.endedBy === ETerminalEnd.PodSlept) {
    return `${terminal.label} went down with the pod. Its scrollback is gone; + starts a fresh shell.`
  }
  if (terminal.exitCode === null) return `${terminal.label} is no longer running.`
  return `${terminal.label} exited with code ${terminal.exitCode}. The row stays until you close it.`
}

export interface EndedBodyProps {
  terminal: PaneTerminal
  onClose: () => void
}

export function EndedBody({ terminal, onClose }: EndedBodyProps) {
  return (
    <Notice
      icon={<TerminalIcon />}
      title="Shell ended"
      description={endedDescription(terminal)}
      action={
        <Button size="sm" variant="outline" onClick={onClose}>
          Close terminal
        </Button>
      }
    />
  )
}

export function DisconnectedBody({ onWake }: { onWake: () => void }) {
  return (
    <Notice
      icon={<UnplugIcon />}
      title="Disconnected"
      description="The pod slept. Every terminal in this thread is disconnected and its scrollback is gone."
      action={
        <Button size="sm" onClick={onWake}>
          <PlayIcon data-icon="inline-start" />
          Wake pod
        </Button>
      }
    />
  )
}

export function EmptyBody({ onCreate }: { onCreate: () => void }) {
  return (
    <Notice
      icon={<TerminalIcon />}
      title="No terminals"
      description="Nothing opens on its own. Start a shell in this thread's pod when you need one."
      action={
        <Button size="sm" onClick={onCreate}>
          <PlusIcon data-icon="inline-start" />
          New terminal
        </Button>
      }
    />
  )
}
