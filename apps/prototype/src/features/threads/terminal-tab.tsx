import { useRef, useState } from 'react'

import { TerminalPanel } from '@dltech/atlas-ui/ai/terminal-panel'
import { TerminalScreen, type TerminalScreenHandle } from '@dltech/atlas-ui/ai/terminal-screen'
import { ETerminalConnection } from '@dltech/atlas-ui/ai/terminal-states'

import { INITIAL_TERMINALS, SANDBOX, type UserTerminal } from './sandbox-terminal'
import { nextInputOf, promptOf, scrollbackOf } from './terminal-ansi'

export interface TerminalTabProps {
  initialConnection?: ETerminalConnection
  terminals?: UserTerminal[]
  noun?: string
  disconnectedMessage?: string
  onReconnect?: () => void
}

function freshTerminal(index: number): UserTerminal {
  return { id: `term-${index}`, label: `Terminal ${index}`, cwd: '~/workspace', entries: [] }
}

interface SimulatedShellProps {
  terminal: UserTerminal
  live: boolean
}

function SimulatedShell({ terminal, live }: SimulatedShellProps) {
  const screen = useRef<TerminalScreenHandle>(null)
  const buffer = useRef('')
  const prompt = promptOf({ cwd: terminal.cwd, host: terminal.host })

  const handleReady = () => {
    screen.current?.write(scrollbackOf(terminal))
    if (live) screen.current?.write(prompt)
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
      readOnly={!live}
      dimmed={!live}
      onReady={handleReady}
      onData={handleData}
    />
  )
}

export function TerminalTab({
  initialConnection = ETerminalConnection.Connected,
  terminals: initialTerminals = INITIAL_TERMINALS,
  noun,
  disconnectedMessage,
  onReconnect,
}: TerminalTabProps) {
  const [connection, setConnection] = useState(initialConnection)
  const [terminals, setTerminals] = useState(initialTerminals)
  const [activeId, setActiveId] = useState(initialTerminals[0]?.id ?? '')
  const active = terminals.find((terminal) => terminal.id === activeId) ?? terminals[0]

  const handleNewTerminal = () => {
    const terminal = freshTerminal(terminals.length + 1)
    setTerminals([...terminals, terminal])
    setActiveId(terminal.id)
  }

  const handleReconnect = () => {
    if (onReconnect) onReconnect()
    else setConnection(ETerminalConnection.Connected)
  }

  return (
    <TerminalPanel
      connection={connection}
      tabs={terminals.map(({ id, label }) => ({ id, label }))}
      activeId={active?.id ?? ''}
      onActiveChange={setActiveId}
      onNew={handleNewTerminal}
      onReconnect={handleReconnect}
      noun={noun}
      detail={SANDBOX.size}
      disconnectedMessage={disconnectedMessage}
    >
      {active ? (
        <SimulatedShell
          key={`${active.id}-${connection}`}
          terminal={active}
          live={connection === ETerminalConnection.Connected}
        />
      ) : null}
    </TerminalPanel>
  )
}
