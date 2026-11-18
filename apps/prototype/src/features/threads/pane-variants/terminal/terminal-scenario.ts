import { useState } from 'react'

import {
  ETerminalEntry,
  INITIAL_TERMINALS,
  type TerminalEntry,
  type UserTerminal,
} from '../../sandbox-terminal'

export enum ETerminalScenario {
  Empty = 'empty',
  Live = 'live',
  Asleep = 'asleep',
}

export enum ETerminalStatus {
  Live = 'live',
  Ended = 'ended',
  Disconnected = 'disconnected',
}

export enum ETerminalEnd {
  Exited = 'exited',
  PodSlept = 'pod-slept',
}

export interface PaneTerminal extends UserTerminal {
  status: ETerminalStatus
  lastCommand: string
  exitCode: number | null
  endedBy: ETerminalEnd | null
}

export const MAX_PANE_TERMINALS = 8

const DEV_ENTRIES: TerminalEntry[] = [
  { kind: ETerminalEntry.Command, cwd: '~/workspace/apps/prototype', command: 'bun run dev' },
  {
    kind: ETerminalEntry.Output,
    text: '  ▲ Next.js 16.3.5\n  - Local:   http://localhost:3100\n\n ✓ Ready in 812ms\n ○ Compiling /threads/[threadId] ...',
  },
]

function fixtureOf(index: number): UserTerminal {
  const fixture = INITIAL_TERMINALS[index]
  if (!fixture) throw new Error(`missing terminal fixture ${index}`)
  return fixture
}

export function liveTerminals(): PaneTerminal[] {
  return [
    {
      ...fixtureOf(0),
      status: ETerminalStatus.Live,
      lastCommand: 'bun run test --filter @dltech/atlas-ui',
      exitCode: null,
      endedBy: null,
    },
    {
      ...fixtureOf(1),
      status: ETerminalStatus.Ended,
      lastCommand: 'git log --oneline -3',
      exitCode: 3,
      endedBy: ETerminalEnd.Exited,
    },
    {
      id: 'term-3',
      label: 'Terminal 3',
      cwd: '~/workspace/apps/prototype',
      entries: DEV_ENTRIES,
      status: ETerminalStatus.Live,
      lastCommand: 'bun run dev',
      exitCode: null,
      endedBy: null,
    },
  ]
}

function asleepOf(terminals: PaneTerminal[]): PaneTerminal[] {
  return terminals.map((terminal) => ({
    ...terminal,
    status: ETerminalStatus.Disconnected,
    entries: [],
    exitCode: null,
    endedBy: null,
  }))
}

function endedByPod(terminals: PaneTerminal[]): PaneTerminal[] {
  return terminals.map((terminal) => ({
    ...terminal,
    status: ETerminalStatus.Ended,
    entries: [],
    exitCode: null,
    endedBy: ETerminalEnd.PodSlept,
  }))
}

export interface TerminalScenarioState {
  scenario: ETerminalScenario
  terminals: PaneTerminal[]
  activeId: string
  active: PaneTerminal | undefined
  setScenario: (scenario: ETerminalScenario) => void
  select: (id: string) => void
  create: () => void
  rename: (id: string, label: string) => void
  close: (id: string) => void
  wake: () => void
}

export function useTerminalScenario(): TerminalScenarioState {
  const [scenario, setScenarioState] = useState(ETerminalScenario.Live)
  const [terminals, setTerminals] = useState(liveTerminals)
  const [activeId, setActiveId] = useState('term-1')
  const [ordinal, setOrdinal] = useState(4)

  const setScenario = (next: ETerminalScenario) => {
    setScenarioState(next)
    if (next === ETerminalScenario.Empty) {
      setTerminals([])
      setActiveId('')
      return
    }
    const rows =
      next === ETerminalScenario.Live
        ? liveTerminals()
        : asleepOf(terminals.length > 0 ? terminals : liveTerminals())
    setTerminals(rows)
    setActiveId(rows[0]?.id ?? '')
  }

  const create = () => {
    if (scenario === ETerminalScenario.Asleep) return
    if (terminals.length >= MAX_PANE_TERMINALS) return
    const terminal: PaneTerminal = {
      id: `term-${ordinal}`,
      label: `Terminal ${ordinal}`,
      cwd: '~/workspace',
      entries: [],
      status: ETerminalStatus.Live,
      lastCommand: '',
      exitCode: null,
      endedBy: null,
    }
    setScenarioState(ETerminalScenario.Live)
    setTerminals([...terminals, terminal])
    setActiveId(terminal.id)
    setOrdinal(ordinal + 1)
  }

  const rename = (id: string, label: string) => {
    const name = label.trim()
    if (name.length === 0) return
    setTerminals((current) =>
      current.map((terminal) => (terminal.id === id ? { ...terminal, label: name } : terminal)),
    )
  }

  const close = (id: string) => {
    const rows = terminals.filter((terminal) => terminal.id !== id)
    setTerminals(rows)
    if (rows.length === 0) {
      setActiveId('')
      setScenarioState(ETerminalScenario.Empty)
      return
    }
    if (id === activeId) setActiveId(rows[rows.length - 1]?.id ?? '')
  }

  const wake = () => {
    setScenarioState(ETerminalScenario.Live)
    setTerminals(endedByPod(terminals))
    setActiveId(terminals[0]?.id ?? '')
  }

  return {
    scenario,
    terminals,
    activeId,
    active: terminals.find((terminal) => terminal.id === activeId) ?? terminals[0],
    setScenario,
    select: setActiveId,
    create,
    rename,
    close,
    wake,
  }
}
