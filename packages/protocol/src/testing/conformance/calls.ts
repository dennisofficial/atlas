import { describe, expect, it } from 'bun:test'

import { EDaemonErrorKind, type OutputChunkFrame } from '../../frames'
import type { CallOp } from '../../ops'
import type { DaemonSession } from '../client'
import type { DaemonConformanceTarget, DaemonSpawnedHandle } from './suite'

const EPOCH = 7

export const execEcho = (text: string): CallOp => ({
  op: 'exec',
  argv: ['/bin/sh', '-c', `echo ${text}`],
})

export const execSleep = (ms: number): CallOp => ({
  op: 'exec',
  argv: ['/bin/sh', '-c', `sleep ${ms / 1000}`],
})

export const decodeChunks = (
  session: DaemonSession,
  key: string,
): { bytes: Uint8Array; offsets: number[] } => {
  const all = session
    .frames()
    .filter((frame): frame is OutputChunkFrame => frame.kind === 'output' && frame.key === key)
  const byOffset = new Map<number, OutputChunkFrame>()
  for (const chunk of all) {
    if (!byOffset.has(chunk.offset)) byOffset.set(chunk.offset, chunk)
  }
  const chunks = [...byOffset.values()].sort((a, b) => a.offset - b.offset)
  const offsets = chunks.map((chunk) => chunk.offset)
  const total = chunks.reduce((sum, chunk) => sum + atob(chunk.bytes).length, 0)
  const bytes = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    const raw = atob(chunk.bytes)
    for (let index = 0; index < raw.length; index++) bytes[at++] = raw.charCodeAt(index)
  }
  return { bytes, offsets }
}

export const expectContiguous = (chunks: { bytes: Uint8Array; offsets: number[] }): void => {
  let cursor = 0
  chunks.offsets.forEach((offset, index) => {
    expect(offset).toBe(cursor)
    cursor = offset + chunkLengthAt(chunks, index)
  })
}

const chunkLengthAt = (chunks: { bytes: Uint8Array; offsets: number[] }, index: number): number => {
  const offsets = chunks.offsets
  const current = offsets[index]
  const next = offsets[index + 1]
  if (current === undefined) return 0
  if (next !== undefined) return next - current
  return chunks.bytes.length - current
}

export const tokenFor = (handle: DaemonSpawnedHandle): string => handle.token

export const helloAt = async (
  session: DaemonSession,
  args: { epoch: number; sessionId: string; token: string },
): Promise<{ bootId: string; version: string }> => {
  session.send({ kind: 'hello', sessionId: args.sessionId, epoch: args.epoch, token: args.token })
  const reply = await session.until((frame) => frame.kind === 'hello-reply')
  if (reply.kind !== 'hello-reply') throw new Error('no hello-reply')
  return { bootId: reply.bootId, version: reply.version }
}

const resultOf = async (
  session: DaemonSession,
  key: string,
): Promise<{
  exitCode: number | null
  output?: string | undefined
  error?: string | undefined
}> => {
  const frame = await session.until((frame) => frame.kind === 'result' && frame.key === key)
  if (frame.kind !== 'result') throw new Error('no result')
  return frame.result
}

export const describeCallsConformance = (target: DaemonConformanceTarget): void => {
  describe(`calls conformance (${target.name})`, () => {
    it('refuses a bad token', async () => {
      const handle = await target.setup()
      try {
        const session = await target.connect(handle)
        session.send({ kind: 'hello', sessionId: 's', epoch: 1, token: 'wrong-token' })
        const closed = await Promise.race([
          session.closed,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
        ])
        expect(closed).not.toBeNull()
      } finally {
        await target.teardown(handle)
      }
    })

    it('hands out the bootId and version on hello and answers ping', async () => {
      const handle = await target.setup()
      try {
        const session = await target.connect(handle)
        const hello = await helloAt(session, {
          epoch: EPOCH,
          sessionId: 's',
          token: tokenFor(handle),
        })
        expect(hello.bootId).toBe(await handle.bootId())
        expect(hello.version.length).toBeGreaterThan(0)
        session.send({ kind: 'ping' })
        const pong = await session.until((frame) => frame.kind === 'pong')
        expect(pong.kind).toBe('pong')
      } finally {
        await target.teardown(handle)
      }
    })

    it('closes the older connection on epoch takeover', async () => {
      const handle = await target.setup()
      try {
        const older = await target.connect(handle)
        await helloAt(older, { epoch: 5, sessionId: 's', token: tokenFor(handle) })
        const newer = await target.connect(handle)
        await helloAt(newer, { epoch: 6, sessionId: 's', token: tokenFor(handle) })
        const closed = await Promise.race([
          older.closed,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
        ])
        expect(closed).not.toBeNull()

        older.send({ kind: 'run', key: 'k-stale', epoch: 5, op: execEcho('stale') })
        await new Promise((resolve) => setTimeout(resolve, 100))
        expect(await handle.spawnCount()).toBe(0)
        newer.close()
      } finally {
        await target.teardown(handle)
      }
    })

    it('spawns once for two runs of the same key', async () => {
      const handle = await target.setup()
      try {
        const session = await target.connect(handle)
        await helloAt(session, { epoch: EPOCH, sessionId: 's', token: tokenFor(handle) })
        const op = execEcho('idempotent')
        session.send({ kind: 'run', key: 'k-1', epoch: EPOCH, op })
        await session.until((frame) => frame.kind === 'run-reply' && frame.key === 'k-1')
        const before = await handle.spawnCount()
        session.send({ kind: 'run', key: 'k-1', epoch: EPOCH, op })
        await resultOf(session, 'k-1')
        session.send({ kind: 'run', key: 'k-1', epoch: EPOCH, op })
        const reply = await session.until(
          (frame) => frame.kind === 'run-reply' && frame.key === 'k-1' && frame.state === 'done',
        )
        expect(reply.kind).toBe('run-reply')
        expect(await handle.spawnCount()).toBe(before)
        expect(before).toBe(1)
      } finally {
        await target.teardown(handle)
      }
    })

    it('attaches while running and delivers the live result', async () => {
      const handle = await target.setup()
      try {
        const session = await target.connect(handle)
        await helloAt(session, { epoch: EPOCH, sessionId: 's', token: tokenFor(handle) })
        session.send({ kind: 'run', key: 'k-run', epoch: EPOCH, op: execSleep(150) })
        const reply = await session.until(
          (frame) => frame.kind === 'run-reply' && frame.key === 'k-run',
        )
        expect(reply.kind === 'run-reply' && reply.state).toBe('running')
        session.send({ kind: 'run', key: 'k-run', epoch: EPOCH, op: execSleep(150) })
        const again = await session.until(
          (frame) =>
            frame.kind === 'run-reply' && frame.key === 'k-run' && frame.state === 'running',
        )
        expect(again.kind).toBe('run-reply')
        const result = await resultOf(session, 'k-run')
        expect(result.exitCode).toBe(0)
        expect(await handle.spawnCount()).toBe(1)
      } finally {
        await target.teardown(handle)
      }
    })

    it('reattaches at an offset with no gap or duplicate', async () => {
      const handle = await target.setup()
      try {
        const session = await target.connect(handle)
        await helloAt(session, { epoch: EPOCH, sessionId: 's', token: tokenFor(handle) })
        session.send({ kind: 'run', key: 'k-gap', epoch: EPOCH, op: execEcho('offset-proof') })
        await resultOf(session, 'k-gap')

        const first = decodeChunks(session, 'k-gap')
        expect(first.bytes.length).toBeGreaterThan(0)

        session.send({ kind: 'run', key: 'k-gap', epoch: EPOCH, op: execEcho('offset-proof') })
        await session.until(
          (frame) => frame.kind === 'run-reply' && frame.key === 'k-gap' && frame.state === 'done',
        )
        const second = decodeChunks(session, 'k-gap')
        const joined = new Uint8Array(first.bytes.length + second.bytes.length)
        joined.set(first.bytes, 0)
        joined.set(second.bytes, first.bytes.length)
        expect(second.bytes.length).toBe(first.bytes.length)
        expect(new TextDecoder().decode(second.bytes)).toBe(new TextDecoder().decode(first.bytes))
        expect(second.offsets[0]).toBe(0)
      } finally {
        await target.teardown(handle)
      }
    })

    it('refuses ack of an unknown key', async () => {
      const handle = await target.setup()
      try {
        const session = await target.connect(handle)
        await helloAt(session, { epoch: EPOCH, sessionId: 's', token: tokenFor(handle) })
        session.send({ kind: 'ack', key: 'k-zombie', epoch: EPOCH })
        const error = await session.until(
          (frame) => frame.kind === 'error' && frame.key === 'k-zombie',
        )
        expect(error.kind === 'error' && error.errorKind).toBe(EDaemonErrorKind.UnknownKey)
      } finally {
        await target.teardown(handle)
      }
    })

    it('deletes a call on ack so a later run reports unknown-key', async () => {
      const handle = await target.setup()
      try {
        const session = await target.connect(handle)
        await helloAt(session, { epoch: EPOCH, sessionId: 's', token: tokenFor(handle) })
        session.send({ kind: 'run', key: 'k-ack', epoch: EPOCH, op: execEcho('gone') })
        await resultOf(session, 'k-ack')
        session.send({ kind: 'ack', key: 'k-ack', epoch: EPOCH })
        await new Promise((resolve) => setTimeout(resolve, 150))
        session.send({ kind: 'ack', key: 'k-ack', epoch: EPOCH })
        const error = await session.until(
          (frame) => frame.kind === 'error' && frame.key === 'k-ack',
        )
        expect(error.kind === 'error' && error.errorKind).toBe(EDaemonErrorKind.UnknownKey)
      } finally {
        await target.teardown(handle)
      }
    })

    it('kills a running call on cancel, including a setsid grandchild when boxed', async () => {
      const handle = await target.setup()
      try {
        const session = await target.connect(handle)
        await helloAt(session, { epoch: EPOCH, sessionId: 's', token: tokenFor(handle) })
        const boxed = await handle.writableCgroups()
        const op: CallOp = boxed
          ? { op: 'exec', argv: ['/bin/sh', '-c', 'setsid sleep 30 & sleep 30'] }
          : execSleep(30_000)
        session.send({ kind: 'run', key: 'k-cancel', epoch: EPOCH, op })
        await session.until((frame) => frame.kind === 'run-reply' && frame.key === 'k-cancel')
        session.send({ kind: 'cancel', key: 'k-cancel', epoch: EPOCH })
        const result = await resultOf(session, 'k-cancel')
        expect(result.error ?? `exit ${result.exitCode}`).not.toBe('exit 0')
      } finally {
        await target.teardown(handle)
      }
    })

    it('prunes unacked results at boot under a new bootId', async () => {
      const first = await target.setup()
      const firstBoot = await first.bootId()
      try {
        const session = await target.connect(first)
        await helloAt(session, { epoch: EPOCH, sessionId: 's', token: tokenFor(first) })
        session.send({ kind: 'run', key: 'k-pruned', epoch: EPOCH, op: execEcho('lost') })
        await resultOf(session, 'k-pruned')
      } finally {
        await first.kill()
      }
      const second = await target.setup()
      try {
        expect(await second.bootId()).not.toBe(firstBoot)
        const session = await target.connect(second)
        await helloAt(session, { epoch: EPOCH, sessionId: 's', token: tokenFor(second) })
        session.send({ kind: 'ack', key: 'k-pruned', epoch: EPOCH })
        const error = await session.until(
          (frame) => frame.kind === 'error' && frame.key === 'k-pruned',
        )
        expect(error.kind === 'error' && error.errorKind).toBe(EDaemonErrorKind.UnknownKey)
      } finally {
        await target.teardown(second)
      }
    })
  })
}
