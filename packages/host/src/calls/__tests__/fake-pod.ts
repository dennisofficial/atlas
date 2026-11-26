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

export const fakePod = (args: { bootId?: string | undefined } = {}) => {
  const daemon = {
    bootId: args.bootId ?? 'boot-a',
    answer: EDaemonAnswer.Running as EDaemonAnswer,
    withholdAnswer: false,
    online: false,
    waiting: false,
    runs: [] as string[],
    cancels: [] as string[],
    answers: [] as string[],
    running: new Set<string>(),
  }
  let handlers: DaemonLinkHandlers | null = null
  let opened: ((socket: DaemonSocket) => void) | null = null

  const deliver = (frame: unknown): void => handlers?.onText(JSON.stringify(frame))

  const handleFrame = (frame: { kind: string; key?: string | undefined }): void => {
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
      handleFrame(JSON.parse(text) as { kind: string; key?: string | undefined })
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
      deliver({ kind: 'hello-reply', bootId: daemon.bootId, version: 'fake' })
    },
    drop: (): void => {
      daemon.online = false
      handlers?.onClose(1006, 'the pod link fell over')
    },
    finish: (settled: { key: string; result: CallResult }): void => {
      daemon.running.delete(settled.key)
      deliver({ kind: 'result', key: settled.key, result: settled.result })
    },
  }
}

export const startFakePod = async (args: { bootId?: string | undefined } = {}) => {
  const fake = fakePod(args)
  const calls = new RemoteCalls({
    sessionId: 'session-1',
    token: 'token',
    connector: fake.connector,
    timers: { ...systemTimers, random: () => 0 },
    pingMs: 600_000,
    handshakeMs: 5_000,
    onFenced: () => {},
  })
  calls.open({ epoch: 1 })
  await until(() => fake.daemon.waiting)
  await fake.open()
  await until(() => calls.bootId() === fake.daemon.bootId)
  return { ...fake, calls }
}
