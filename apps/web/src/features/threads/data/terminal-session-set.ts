import {
  openTerminal as openRemoteTerminal,
  type RemoteDeltaChannel,
  type TerminalFrameChannel,
  type TerminalSession,
  type Unsubscribe,
} from '@dltech/atlas-client/channel'
import type { TerminalExitWire } from '@dltech/atlas-wire/web'

export const MAX_TERMINALS = 8

export enum ETerminalTabState {
  Opening = 'opening',
  Open = 'open',
  Ended = 'ended',
  Failed = 'failed',
  Suspended = 'suspended',
}

export type TerminalChannel = Pick<RemoteDeltaChannel, 'request'> & TerminalFrameChannel

export type OpenTerminal = (args: {
  channel: TerminalChannel
  cols: number
  rows: number
}) => Promise<TerminalSession>

export type TerminalSink = { write: (data: string) => void }

export type TerminalSize = { cols: number; rows: number }

export type TerminalTabView = {
  id: string
  name: string
  state: ETerminalTabState
  exit: TerminalExitWire | null
  error: string | null
}

export type TerminalSetView = {
  tabs: readonly TerminalTabView[]
  activeId: string
  epoch: number
}

export type TerminalSet = {
  view: () => TerminalSetView
  subscribe: (listener: () => void) => () => void
  attach: (args: { id: string; sink: TerminalSink; size: TerminalSize }) => void
  detach: (args: { id: string; sink: TerminalSink }) => void
  input: (args: { id: string; data: string }) => void
  resize: (args: { id: string; size: TerminalSize }) => void
  select: (id: string) => void
  add: () => string | null
  close: (id: string) => void
  suspend: () => void
  resume: () => void
  dispose: () => void
}

type Tab = {
  id: string
  name: string
  state: ETerminalTabState
  exit: TerminalExitWire | null
  error: string | null
  session: TerminalSession | null
  sink: TerminalSink | null
  size: TerminalSize | null
  releases: Unsubscribe[]
  generation: number
  opening: boolean
}

const noop = () => undefined

const quietly = (pending: Promise<unknown>): void => void pending.catch(noop)

const noticeLine = (text: string): string => `\r\n\x1b[2m${text}\x1b[0m\r\n`

const sameSize = (left: TerminalSize, right: TerminalSize): boolean =>
  left.cols === right.cols && left.rows === right.rows

export const tabLabelOf = (tab: TerminalTabView): string =>
  tab.state === ETerminalTabState.Ended ? `${tab.name} · ended` : tab.name

export function exitLabelOf(exit: TerminalExitWire | null): string {
  if (exit === null || exit.exitCode === 0) return 'Shell exited'
  if (exit.exitCode !== null) return `Shell exited with code ${exit.exitCode}.`
  if (exit.signal !== null) return `Shell ended by ${exit.signal}`
  return 'Shell exited'
}

export function createTerminalSet(args: {
  channel: TerminalChannel
  open?: OpenTerminal
}): TerminalSet {
  const { channel } = args
  const openSession = args.open ?? openRemoteTerminal
  const tabs: Tab[] = []
  const listeners = new Set<() => void>()
  let counter = 0
  let epoch = 0
  let activeId = ''
  let suspended = false
  let disposed = false

  const viewOf = (): TerminalSetView => ({
    tabs: tabs.map(({ id, name, state, exit, error }) => ({
      id,
      name,
      state,
      exit,
      error,
    })),
    activeId,
    epoch,
  })
  let snapshot = viewOf()

  const notify = () => {
    snapshot = viewOf()
    for (const listener of [...listeners]) listener()
  }

  const find = (id: string): Tab | undefined => tabs.find((tab) => tab.id === id)

  const forget = (tab: Tab) => {
    tab.generation += 1
    tab.opening = false
    for (const release of tab.releases) release()
    tab.releases = []
  }

  const hangUp = (tab: Tab) => {
    const { session } = tab
    forget(tab)
    tab.session = null
    if (session) quietly(session.close())
  }

  const makeTab = (): Tab => {
    counter += 1
    return {
      id: `term-${counter}`,
      name: `Terminal ${counter}`,
      state: suspended ? ETerminalTabState.Suspended : ETerminalTabState.Opening,
      exit: null,
      error: null,
      session: null,
      sink: null,
      size: null,
      releases: [],
      generation: 0,
      opening: false,
    }
  }

  const handleExit = (args: { tab: Tab; exit: TerminalExitWire }) => {
    const { tab, exit } = args
    forget(tab)
    tab.session = null
    tab.state = ETerminalTabState.Ended
    tab.exit = exit
    tab.sink?.write(noticeLine(exitLabelOf(exit)))
    notify()
  }

  const open = async (args: { tab: Tab; size: TerminalSize }) => {
    const { tab, size } = args
    const { generation } = tab
    tab.opening = true
    try {
      const session = await openSession({ channel, ...size })
      if (disposed || tab.generation !== generation) {
        quietly(session.close())
        return
      }
      tab.opening = false
      tab.session = session
      tab.state = ETerminalTabState.Open
      tab.releases = [
        session.onOutput((data) => tab.sink?.write(data)),
        session.onExit((exit) => handleExit({ tab, exit })),
      ]
      if (tab.size !== null && !sameSize(tab.size, size)) quietly(session.resize(tab.size))
    } catch (failure) {
      if (tab.generation !== generation) return
      tab.opening = false
      tab.state = ETerminalTabState.Failed
      tab.error = failure instanceof Error ? failure.message : String(failure)
      tab.sink?.write(noticeLine(tab.error))
    }
    notify()
  }

  const first = makeTab()
  tabs.push(first)
  activeId = first.id
  snapshot = viewOf()

  return {
    view: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    attach: ({ id, sink, size }) => {
      const tab = find(id)
      if (disposed || tab === undefined) return
      tab.sink = sink
      tab.size = size
      if (tab.session) {
        quietly(tab.session.resize(size))
        return
      }
      if (tab.state !== ETerminalTabState.Opening || tab.opening) return
      void open({ tab, size })
    },
    detach: ({ id, sink }) => {
      const tab = find(id)
      if (tab?.sink === sink) tab.sink = null
    },
    input: ({ id, data }) => {
      const session = find(id)?.session
      if (session) quietly(session.write(data))
    },
    resize: ({ id, size }) => {
      const tab = find(id)
      if (tab === undefined) return
      tab.size = size
      if (tab.session) quietly(tab.session.resize(size))
    },
    select: (id) => {
      if (find(id) === undefined || activeId === id) return
      activeId = id
      notify()
    },
    add: () => {
      if (disposed || tabs.length >= MAX_TERMINALS) return null
      const tab = makeTab()
      tabs.push(tab)
      activeId = tab.id
      notify()
      return tab.id
    },
    close: (id) => {
      const index = tabs.findIndex((tab) => tab.id === id)
      const tab = tabs[index]
      if (tab === undefined) return
      hangUp(tab)
      tabs.splice(index, 1)
      if (tabs.length === 0) {
        const fresh = makeTab()
        tabs.push(fresh)
        activeId = fresh.id
      } else if (activeId === id) {
        activeId = (tabs[Math.min(index, tabs.length - 1)] ?? tabs[0])?.id ?? ''
      }
      notify()
    },
    suspend: () => {
      if (suspended || disposed) return
      suspended = true
      for (const tab of tabs) {
        hangUp(tab)
        tab.state = ETerminalTabState.Suspended
      }
      notify()
    },
    resume: () => {
      if (!suspended || disposed) return
      suspended = false
      epoch += 1
      for (const tab of tabs) {
        forget(tab)
        tab.state = ETerminalTabState.Opening
        tab.exit = null
        tab.error = null
        tab.sink = null
      }
      notify()
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      for (const tab of tabs) hangUp(tab)
      listeners.clear()
    },
  }
}
