import { EDaemonAnswer } from '@dltech/atlas-core'
import type { CallResult } from '@dltech/atlas-protocol'

import { RemoteCalls, systemTimers } from '../remote-calls'
import type { DaemonConnector, DaemonLinkHandlers, DaemonSocket } from '../socket'

export const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

export const until = async (ready: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (ready()) return
    await tick()
  }
  throw new Error('the fake pod never reached the expected state')
}

export type FakePodFrame = { kind: string; key?: string | undefined; scope?: string | undefined }

export const fakePod = (
  args: { bootId?: string | undefined; capabilities?: readonly string[] } = {},
) => {
  const daemon = {
    bootId: args.bootId ?? 'boot-a',
    answer: EDaemonAnswer.Running as EDaemonAnswer,
    withholdAnswer: false,
    online: false,
    waiting: false,
    runs: [] as string[],
    cancels: [] as string[],
    scopes: [] as string[],
    answers: [] as string[],
    running: new Set<string>(),
  }
  let handlers: DaemonLinkHandlers | null = null
  let opened: ((socket: DaemonSocket) => void) | null = null

  const deliver = (frame: unknown): void => handlers?.onText(JSON.stringify(frame))

  const handleFrame = (frame: FakePodFrame): void => {
    if (frame.kind === 'cancel-scope') {
      const scope = frame.scope ?? ''
      const cancelled = [...daemon.running].filter((key) => key.startsWith(`${scope}.`))
      for (const key of cancelled) daemon.running.delete(key)
      daemon.scopes.push(scope)
      deliver({ kind: 'scope-cancelled', scope, cancelled })
      return
    }
    if (frame.key === undefined) return
    if (frame.kind === 'run') {
      daemon.runs.push(frame.key)
      daemon.running.add(frame.key)
      return
    }
    if (frame.kind === 'cancel') {
      daemon.cancels.push(frame.key)
      daemon.running.delete(frame.key)
      return
    }
    if (frame.kind !== 'answer') return
    daemon.answers.push(frame.key)
    if (daemon.withholdAnswer) return
    deliver({ kind: 'answered', key: frame.key, state: daemon.answer })
  }

  const socket: DaemonSocket = {
    send: (text) => {
      if (!daemon.online) return
      handleFrame(JSON.parse(text) as FakePodFrame)
    },
    close: () => {},
  }

  return {
    daemon,
    connector: async (): Promise<DaemonConnector> => async (link) => {
      handlers = link
      daemon.waiting = true
      return await new Promise<DaemonSocket>((resolve) => {
        opened = resolve
      })
    },
    open: async (): Promise<void> => {
      const resolve = opened
      if (resolve === null) throw new Error('the host never reconnected')
      opened = null
      daemon.online = true
      daemon.waiting = false
      resolve(socket)
      await new Promise((done) => setTimeout(done, 0))
      deliver({
        kind: 'hello-reply',
        bootId: daemon.bootId,
        version: 'fake',
        ...(args.capabilities === undefined ? {} : { capabilities: args.capabilities }),
      })
    },
    drop: (): void => {
      daemon.online = false
      handlers?.onClose(1006, 'the pod link fell over')
    },
    answerNow: (args: { key: string; state: EDaemonAnswer }): void => {
      deliver({ kind: 'answered', key: args.key, state: args.state })
    },
    finish: (settled: { key: string; result: CallResult }): void => {
      daemon.running.delete(settled.key)
      deliver({ kind: 'result', key: settled.key, result: settled.result })
    },
  }
}

export type FakePod = ReturnType<typeof fakePod>

export const openCallsOn = async (args: {
  pod: FakePod
  epoch: number
  sessionId?: string | undefined
}): Promise<RemoteCalls> => {
  const calls = new RemoteCalls({
    sessionId: args.sessionId ?? 'session-1',
    token: 'token',
    connector: args.pod.connector,
    timers: { ...systemTimers, random: () => 0 },
    pingMs: 600_000,
    handshakeMs: 5_000,
    onFenced: () => {},
  })
  calls.open({ epoch: args.epoch })
  await until(() => args.pod.daemon.waiting)
  await args.pod.open()
  await until(() => calls.bootId() === args.pod.daemon.bootId)
  return calls
}

export const startFakePod = async (
  args: { bootId?: string | undefined; capabilities?: readonly string[] } = {},
) => {
  const pod = fakePod(args)
  const calls = await openCallsOn({ pod, epoch: 1 })
  return { ...pod, calls }
}
