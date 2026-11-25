import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

import { expect } from 'bun:test'

import type { ControlPlane } from '@dltech/atlas-control'
import { RemoteCalls, systemTimers, webSocketConnector } from '@dltech/atlas-host'
import { sandboxNameOf } from '@dltech/atlas-pods/sandbox/vercel-names'
import { daemonToken } from '@dltech/atlas-protocol/engine'
import type { CallOp, CallResult } from '@dltech/atlas-protocol'

import { RIG_SECRET } from '../../testing/rig-host-env'
import type { FaultRig, ReadEvent } from '../../testing/fault-rig'

export const makeFifo = (args: { path: string }): void => {
  const result = spawnSync('mkfifo', [args.path])
  if (result.status !== 0) {
    throw new Error(`mkfifo ${args.path} failed: ${result.stderr.toString()}`)
  }
}

export const readEvents = async (args: {
  plane: ControlPlane
  threadId: string
}): Promise<ReadEvent[]> => {
  const page = await args.plane.readEvents({
    threadId: args.threadId,
    afterSeq: 0,
    limit: 1_000,
    visible: true,
  })
  return page.events.map((row) => ({ seq: row.seq, type: row.type, event: row }))
}

export const callIdOf = (row: ReadEvent): string | undefined =>
  (row.event as { callId?: string }).callId

export const isDoneResult = (row: ReadEvent): boolean => {
  if (row.type !== 'tool-result') return false
  const result = row.event as { output?: unknown; interrupted?: boolean }
  if (result.interrupted === true) return false
  if (typeof result.output !== 'object' || result.output === null) return false
  const output = result.output as { stdout?: unknown; exitCode?: unknown }
  return (
    output.exitCode === 0 && typeof output.stdout === 'string' && output.stdout.includes('done')
  )
}

export const waitForFile = async (args: { path: string; timeoutMs?: number }): Promise<void> => {
  const deadline = Date.now() + (args.timeoutMs ?? 20_000)
  while (Date.now() < deadline) {
    if (existsSync(args.path)) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`timed out waiting for ${args.path}`)
}

export const releaseFifo = async (args: { path: string; timeoutMs?: number }): Promise<void> => {
  const child = Bun.spawn({
    cmd: ['sh', '-c', `printf 'go\\n' > '${args.path}'`],
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
  })
  const done = await Promise.race([
    child.exited.then(() => true as const),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), args.timeoutMs ?? 10_000)),
  ])
  if (!done) {
    child.kill('SIGKILL')
    await child.exited.catch(() => undefined)
    throw new Error(`timed out releasing ${args.path}`)
  }
}

export const expectOneResultPerDispatch = (events: readonly ReadEvent[]): void => {
  for (const marker of events.filter((row) => row.type === 'tool-dispatched')) {
    const id = callIdOf(marker)
    expect(events.filter((row) => row.type === 'tool-result' && callIdOf(row) === id)).toHaveLength(
      1,
    )
  }
}

/**
 * A session is held only while it has work, so a finished turn's lease is released before a spec
 * can read it. What must still hold: no other host took the session over, and the crash-loop
 * counter is clear.
 */
export const expectLeaseSettled = async (args: {
  rig: FaultRig
  sessionId: string
  holder?: string
}): Promise<void> => {
  const { lease } = await args.rig.plane.currentLease({ sessionId: args.sessionId })
  if (args.holder !== undefined && lease.holderHostId !== null) {
    expect(await args.rig.labelOf(lease.holderHostId)).toBe(args.holder)
  }
  expect(lease.attempts).toBe(0)
}

export const expectEpochsOrdered = (args: {
  events: readonly ReadEvent[]
  finalEpoch: number
}): void => {
  const epochs = args.events.map((row) => (row.event as { epoch?: number }).epoch ?? 0)
  for (const [index, epoch] of epochs.entries()) {
    expect(epoch).toBeLessThanOrEqual(args.finalEpoch)
    const previous = epochs[index - 1]
    if (previous !== undefined) expect(epoch).toBeGreaterThanOrEqual(previous)
  }
}

export const daemonCall = async (args: {
  url: string
  sessionId: string
  epoch: number
  key: string
  op: CallOp
}): Promise<CallResult> => {
  const calls = new RemoteCalls({
    sessionId: args.sessionId,
    token: daemonToken({ secret: RIG_SECRET, sandboxName: sandboxNameOf(args.sessionId) }),
    connector: () => Promise.resolve(webSocketConnector({ url: args.url })),
    timers: systemTimers,
    onFenced: () => {},
  })
  calls.open({ epoch: args.epoch })
  try {
    await calls.ready()
    return await calls.invoke({ key: args.key, op: args.op })
  } finally {
    calls.close()
  }
}
