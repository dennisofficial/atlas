import { describe, expect, it } from 'bun:test'

import { createInMemoryDaemon, inMemoryDaemonToken } from '@dltech/atlas-protocol/testing'

import { RemoteCalls, type DaemonConnector } from '@dltech/atlas-host'

import { ensureWorkspace } from '../workspace-setup'
import { RecordingProcessPort, StubFileSystemPort } from './workspace-fakes'

const SANDBOX = 'atlas-v2-prepare-acks'
const SECRET = 'prepare-acks-secret'

describe('workspace prepare and its scope acks', () => {
  it('finishes the preparation when the daemon never answers its acks', async () => {
    const daemon = await createInMemoryDaemon({
      version: 'test',
      sandboxName: SANDBOX,
      secret: SECRET,
    })
    const timers = fakeClock()
    const connector = (): Promise<DaemonConnector> =>
      Promise.resolve((handlers) => {
        const inner = daemon.connectRaw({
          onText: (text) => handlers.onText(text),
          onClose: (code, reason) => handlers.onClose(code, reason),
        })
        return Promise.resolve({
          send: (text) => {
            const frame: { kind?: string } = JSON.parse(text)
            if (frame.kind === 'ack') return
            inner.send(text)
          },
          close: () => inner.close(),
        })
      })
    const calls = new RemoteCalls({
      sessionId: 's-prepare-acks',
      token: inMemoryDaemonToken({ secret: SECRET, sandboxName: SANDBOX }),
      connector,
      timers,
      pingMs: 600_000,
      onFenced: () => {},
    })
    calls.open({ epoch: 1 })
    await calls.ready()

    let prepared: unknown
    void ensureWorkspace({
      calls: { ackScope: (args) => calls.ackScope(args) },
      processes: new RecordingProcessPort(),
      files: new StubFileSystemPort(),
      workspace: {
        remoteUrl: null,
        baseBranch: null,
        additionalRepos: [],
        setupScript: 'bun install',
      },
      githubToken: null,
      launchDirectory: '/workspace/repo',
      sandboxName: 'sandbox-a',
    }).then(
      (result) => {
        prepared = result
      },
      (error: unknown) => {
        prepared = error
      },
    )

    for (let round = 0; round < 8 && prepared === undefined; round += 1) {
      await Bun.sleep(5)
      timers.advance(10_000)
    }

    expect(prepared).toEqual({ ok: true })
    calls.close()
  })
})

type FakeClock = {
  setTimeout(handler: () => void, ms: number): unknown
  clearTimeout(timer: unknown): void
  random(): number
  advance(ms: number): void
}

const fakeClock = (): FakeClock => {
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
      for (const [id, timer] of [...timers.entries()].filter(([, entry]) => entry.at <= now)) {
        timers.delete(id)
        timer.handler()
      }
    },
  }
}
