import { describe, expect, it } from 'bun:test'

import { ECallFailure, ECallStatus, EExecOutcome } from '@dltech/atlas-protocol'

import { FencedError, SandboxUnavailableError } from '..'
import { openCalls, uniqueKey, type RemoteCallsTarget } from './remote-calls-support'

export const describeRemoteCallsLifecycle = (target: RemoteCallsTarget): void => {
  describe(`remote calls lifecycle (${target.name})`, () => {
    it('streams exec output and returns the result', async () => {
      const handle = await target.start()
      try {
        const calls = openCalls({ handle })
        const chunks: string[] = []
        const result = await calls.invoke({
          key: uniqueKey('exec'),
          op: { op: 'exec', argv: ['/bin/sh', '-c', 'echo one; sleep 0.2; echo two'] },
          onOutput: (bytes) => chunks.push(Buffer.from(bytes).toString('utf8')),
        })
        expect(result.status).toBe(ECallStatus.Ok)
        if (result.status === 'ok' && result.op === 'exec') {
          expect(result.value.outcome).toBe(EExecOutcome.Exited)
        }
        expect(chunks.join('')).toBe('one\ntwo\n')
        calls.close()
      } finally {
        await handle.stop()
      }
    })

    it('spawns once when the same key is invoked twice or after a reconnect', async () => {
      const handle = await target.start()
      try {
        const calls = openCalls({ handle })
        const key = uniqueKey('dedupe')
        const op = { op: 'exec', argv: ['/bin/sh', '-c', 'echo once'] } as const
        const [first, second] = await Promise.all([
          calls.invoke({ key, op }),
          calls.invoke({ key, op }),
        ])
        expect(first).toEqual(second)
        if (handle.runCount() !== undefined) expect(handle.runCount()).toBe(1)
        calls.close()
      } finally {
        await handle.stop()
      }
    })

    it('reattaches after a dropped link with the output neither doubled nor missing', async () => {
      const handle = await target.start()
      try {
        const sockets: { close(): void }[] = []
        const calls = openCalls({
          handle,
          connector: async () => {
            const inner = await handle.connectorFor()()
            return (handlers) =>
              inner({ onText: handlers.onText, onClose: handlers.onClose }).then((socket) => {
                sockets.push(socket)
                return socket
              })
          },
        })
        const chunks: string[] = []
        const done = calls.invoke({
          key: uniqueKey('gap'),
          op: { op: 'exec', argv: ['/bin/sh', '-c', 'echo first; sleep 0.4; echo second'] },
          onOutput: (bytes) => chunks.push(Buffer.from(bytes).toString('utf8')),
        })
        await new Promise((resolve) => setTimeout(resolve, 200))
        sockets[0]?.close()
        const result = await done
        expect(result.status).toBe(ECallStatus.Ok)
        expect(chunks.join('')).toBe('first\nsecond\n')
        if (handle.runCount() !== undefined) expect(handle.runCount()).toBe(1)
        calls.close()
      } finally {
        await handle.stop()
      }
    }, 15000)

    it('fails an in-flight exec as interrupted on restart, and reruns a read-only op', async () => {
      const handle = await target.start()
      try {
        const calls = openCalls({ handle })
        await calls.ready()
        const execDone = calls.invoke({
          key: uniqueKey('lost'),
          op: { op: 'exec', argv: ['/bin/sh', '-c', 'sleep 30'] },
        })
        const statDone = calls.invoke({
          key: uniqueKey('rerun'),
          op: { op: 'stat', path: '/' },
        })
        await new Promise((resolve) => setTimeout(resolve, 100))
        await handle.restart()
        const [execResult, statResult] = await Promise.all([execDone, statDone])
        expect(execResult.status).toBe(ECallStatus.Failed)
        if (execResult.status === 'failed') {
          expect(execResult.error.code).toBe(ECallFailure.Interrupted)
          expect(execResult.error.message).toContain('interrupted by a daemon restart')
        }
        expect(statResult.status).toBe(ECallStatus.Ok)
        calls.close()
      } finally {
        await handle.stop()
      }
    }, 15000)

    it('collects a finished call the daemon still holds when its dispatch boot is gone', async () => {
      const handle = await target.start()
      try {
        const first = openCalls({ handle })
        const key = uniqueKey('kept')
        const op = { op: 'exec', argv: ['/bin/sh', '-c', 'echo kept'] } as const
        await first.invoke({ key, op })
        first.close()

        const second = openCalls({ handle })
        await second.ready()
        const chunks: string[] = []
        const result = await second.invoke({
          key,
          op,
          dispatchedBootId: 'previous-boot',
          onOutput: (bytes) => chunks.push(Buffer.from(bytes).toString('utf8')),
        })
        expect(result.status).toBe(ECallStatus.Ok)
        expect(chunks.join('')).toBe('kept\n')
        if (handle.runCount() !== undefined) expect(handle.runCount()).toBe(1)
        second.close()
      } finally {
        await handle.stop()
      }
    })

    it('fails as interrupted, without running anything, when the daemon never saw the dispatch', async () => {
      const handle = await target.start()
      try {
        const calls = openCalls({ handle })
        await calls.ready()
        const result = await calls.invoke({
          key: uniqueKey('never'),
          op: { op: 'exec', argv: ['/bin/sh', '-c', 'echo nope'] },
          dispatchedBootId: 'previous-boot',
        })
        expect(result.status).toBe(ECallStatus.Failed)
        if (result.status === 'failed') expect(result.error.code).toBe(ECallFailure.Interrupted)
        if (handle.runCount() !== undefined) expect(handle.runCount()).toBe(0)
        calls.close()
      } finally {
        await handle.stop()
      }
    })

    it('fences the older holder when a second opens at a higher epoch', async () => {
      const handle = await target.start()
      try {
        let fenced = 0
        const first = openCalls({ handle, epoch: 1, onFenced: () => (fenced += 1) })
        await first.ready()
        const second = openCalls({ handle, epoch: 2 })
        await second.ready()
        for (let waited = 0; fenced === 0 && waited < 5_000; waited += 25) {
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
        await expect(
          first.invoke({ key: uniqueKey('fenced'), op: { op: 'stat', path: '/' } }),
        ).rejects.toBeInstanceOf(FencedError)
        expect(fenced).toBe(1)
        const ok = await second.invoke({ key: uniqueKey('holder'), op: { op: 'stat', path: '/' } })
        expect(ok.status).toBe(ECallStatus.Ok)
        first.close()
        second.close()
      } finally {
        await handle.stop()
      }
    })

    it('waits for a slow connector in ready, and fails invokes when the sandbox is unavailable', async () => {
      const handle = await target.start()
      try {
        const slow = openCalls({
          handle,
          connector: async () => {
            await new Promise((resolve) => setTimeout(resolve, 300))
            return handle.connectorFor()()
          },
        })
        await slow.ready()
        const result = await slow.invoke({ key: uniqueKey('slow'), op: { op: 'stat', path: '/' } })
        expect(result.status).toBe(ECallStatus.Ok)
        slow.close()

        const unavailable = new SandboxUnavailableError('sandbox failed to wake')
        const down = openCalls({ handle, connector: () => Promise.reject(unavailable) })
        await expect(down.ready()).rejects.toBe(unavailable)
        await expect(
          down.invoke({ key: uniqueKey('down'), op: { op: 'stat', path: '/' } }),
        ).rejects.toBe(unavailable)
      } finally {
        await handle.stop()
      }
    })
  })
}
