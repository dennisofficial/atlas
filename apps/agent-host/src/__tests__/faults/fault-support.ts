import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

import type { ControlPlane } from '@dltech/atlas-control'

import type { ReadEvent } from '../../testing/fault-rig'

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
