import { describe, expect, it } from 'bun:test'

import { ECallStatus, EExecOutcome, type CallOp, type CallResult } from '@dltech/atlas-protocol'

import { RemoteCalls, systemTimers } from '../remote-calls'
import type { DaemonConnector, DaemonLinkHandlers, DaemonSocket } from '../socket'

const EXEC: CallOp = { op: 'exec', argv: ['sleep', '60'] }
const KEY = 'session-1:exec.0'

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const until = async (ready: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (ready()) return
    await tick()
  }
  throw new Error('the fake pod never reached the expected state')
}

const cancelledExec = (): CallResult => ({
  status: ECallStatus.Ok,
  op: 'exec',
  value: { exitCode: null, signal: 'SIGTERM', outcome: EExecOutcome.Cancelled, outputBytes: 0 },
})

const fakePod = () => {
  const pod = {
    bootId: 'boot-a',
    online: false,
    waiting: false,
    runs: [] as string[],
    cancels: [] as string[],
    running: new Set<string>(),
  }
  let handlers: DaemonLinkHandlers | null = null
  let opened: ((socket: DaemonSocket) => void) | null = null

  const deliver = (frame: unknown): void => handlers?.onText(JSON.stringify(frame))

  const socket: DaemonSocket = {
    send: (text) => {
      if (!pod.online) return
      const frame = JSON.parse(text) as { kind: string; key?: string }
      if (frame.kind === 'run' && frame.key !== undefined) {
        pod.runs.push(frame.key)
        pod.running.add(frame.key)
        return
      }
      if (frame.kind === 'cancel' && frame.key !== undefined) {
        pod.cancels.push(frame.key)
        pod.running.delete(frame.key)
        deliver({ kind: 'result', key: frame.key, result: cancelledExec() })
      }
    },
    close: () => {},
  }

  const connector = async (): Promise<DaemonConnector> => async (link) => {
    handlers = link
    pod.waiting = true
    return await new Promise<DaemonSocket>((resolve) => {
      opened = resolve
    })
  }

  const open = async (): Promise<void> => {
    const resolve = opened
    if (resolve === null) throw new Error('the host never reconnected')
    opened = null
    pod.online = true
    pod.waiting = false
    resolve(socket)
    await tick()
    deliver({ kind: 'hello-reply', bootId: pod.bootId, version: 'fake' })
  }

  const drop = (): void => {
    pod.online = false
    handlers?.onClose(1006, 'the pod link fell over')
  }

  return { pod, connector, open, drop }
}

const started = async () => {
  const fake = fakePod()
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
  await until(() => fake.pod.waiting)
  await fake.open()
  await until(() => calls.bootId() === fake.pod.bootId)
  return { ...fake, calls }
}

describe('a stop with the link down still reaches the daemon', () => {
  it('sends the cancel when the link comes back on the same boot', async () => {
    const { pod, calls, open, drop } = await started()
    const controller = new AbortController()
    const outcome = calls.invoke({ key: KEY, op: EXEC, signal: controller.signal })
    await until(() => pod.running.has(KEY))

    drop()
    await until(() => !calls.linked())
    controller.abort()
    expect((await outcome).status).toBe(ECallStatus.Failed)
    expect(pod.cancels).toEqual([])

    await until(() => pod.waiting)
    await open()
    await until(() => pod.cancels.length > 0)
    expect(pod.cancels).toEqual([KEY])
    expect(pod.runs).toEqual([KEY])
    expect(pod.running.has(KEY)).toBe(false)
    calls.close()
  })

  it('drops the cancel when the daemon answers from a new boot', async () => {
    const { pod, calls, open, drop } = await started()
    const controller = new AbortController()
    void calls.invoke({ key: KEY, op: EXEC, signal: controller.signal })
    await until(() => pod.running.has(KEY))

    drop()
    await until(() => !calls.linked())
    controller.abort()
    await until(() => pod.waiting)

    pod.bootId = 'boot-b'
    pod.running.clear()
    await open()
    await until(() => calls.bootId() === 'boot-b')
    await tick()
    expect(pod.cancels).toEqual([])
    calls.close()
  })
})
