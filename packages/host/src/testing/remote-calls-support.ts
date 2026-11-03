import { RemoteCalls, systemTimers, type CallTimers, type DaemonConnector } from '..'

export type RemoteCallsTarget = {
  name: string
  start(): Promise<RemoteCallsHandle>
}

export type RemoteCallsHandle = {
  token: string
  connectorFor(): () => Promise<DaemonConnector>
  restart(): Promise<void>
  runCount(): number | undefined
  stop(): Promise<void>
}

export type SlowTimers = CallTimers & {
  advance(ms: number): void
}

export const fakeTimers = (): SlowTimers => {
  let now = 0
  let seq = 0
  const timers = new Map<number, { at: number; handler: () => void }>()
  return {
    setTimeout: (handler, ms) => {
      seq += 1
      timers.set(seq, { at: now + ms, handler })
      return seq
    },
    clearTimeout: (timer) => {
      timers.delete(timer as number)
    },
    random: () => 0.5,
    advance: (ms) => {
      now += ms
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= now)
      for (const [id, timer] of due) {
        timers.delete(id)
        timer.handler()
      }
    },
  }
}

export const openCalls = (args: {
  handle: RemoteCallsHandle
  epoch?: number
  timers?: CallTimers
  onFenced?: (() => void) | undefined
  connector?: (() => Promise<DaemonConnector>) | undefined
}): RemoteCalls => {
  const calls = new RemoteCalls({
    sessionId: 's-test',
    token: args.handle.token,
    connector: args.connector ?? args.handle.connectorFor(),
    timers: args.timers ?? systemTimers,
    onFenced: args.onFenced ?? (() => {}),
  })
  calls.open({ epoch: args.epoch ?? 1 })
  return calls
}

export const uniqueKey = (() => {
  let n = 0
  return (prefix: string) => `${prefix}-${(n += 1)}`
})()
