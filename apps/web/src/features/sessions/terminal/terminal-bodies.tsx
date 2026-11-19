'use client'

import { PlusIcon, TerminalIcon } from 'lucide-react'

import { Notice } from '@dltech/atlas-ui/ai/notice'
import {
  TerminalScreen,
  type TerminalScreenHandle,
  type TerminalSize,
} from '@dltech/atlas-ui/ai/terminal-screen'
import { Button } from '@dltech/atlas-ui/components/button'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { ETerminalTabState, type TerminalTab, tabLabelOf } from './terminal-model'

export function TerminalScreens(props: {
  tabs: readonly TerminalTab[]
  activeId: string | undefined
  register: (terminalId: string, handle: TerminalScreenHandle | null) => void
  onReady: (terminalId: string) => void
  onData: (terminalId: string, data: string) => void
  onResize: (terminalId: string, size: TerminalSize) => void
}) {
  return (
    <>
      {props.tabs.map((tab) => {
        const { terminalId } = tab.row
        const active = terminalId === props.activeId
        return (
          <div
            key={terminalId}
            data-terminal-screen={terminalId}
            className={cn('min-h-0 min-w-0 flex-1 flex-col', active ? 'flex' : 'hidden')}
          >
            <TerminalScreen
              ref={(handle) => props.register(terminalId, handle)}
              label={`${tab.row.name || tabLabelOf(tab.row)} output`}
              onReady={() => props.onReady(terminalId)}
              onData={(data) => props.onData(terminalId, data)}
              onResize={(size) => props.onResize(terminalId, size)}
              className="px-0 py-0"
            />
          </div>
        )
      })}
    </>
  )
}

export function TerminalEmptyBody({ onCreate }: { onCreate: () => void }) {
  return (
    <Notice
      icon={<TerminalIcon />}
      title="No terminals"
      description="Nothing opens on its own. Start a shell in this session's pod when you need one."
      action={
        <Button size="sm" onClick={onCreate}>
          <PlusIcon data-icon="inline-start" />
          New terminal
        </Button>
      }
    />
  )
}

const endedDescription = (tab: TerminalTab): string => {
  const label = tab.row.name || tabLabelOf(tab.row)
  if (tab.row.endedReason === 'pod-slept') {
    return `${label} went down with the pod. Its scrollback is gone; + starts a fresh shell.`
  }
  if (tab.row.exitCode !== null) {
    return `${label} exited with code ${tab.row.exitCode}. The row stays until you close it.`
  }
  return `${label} is no longer running.`
}

export function TerminalEndedBody(props: { tab: TerminalTab; onClose: () => void }) {
  return (
    <div data-terminal-ended={props.tab.row.terminalId}>
      <Notice
        icon={<TerminalIcon />}
        title="Shell ended"
        description={endedDescription(props.tab)}
        action={
          <Button size="sm" variant="outline" onClick={props.onClose}>
            Close terminal
          </Button>
        }
      />
    </div>
  )
}

export function TerminalFailedBody(props: { tab: TerminalTab; onClose: () => void }) {
  return (
    <div data-terminal-failed={props.tab.row.terminalId}>
      <Notice
        icon={<TerminalIcon />}
        title="Shell failed"
        description={`${props.tab.row.name || tabLabelOf(props.tab.row)} could not start. Close it and start a fresh shell.`}
        action={
          <Button size="sm" variant="outline" onClick={props.onClose}>
            Close terminal
          </Button>
        }
      />
    </div>
  )
}

export const endedState = ETerminalTabState.Ended
