import type { CallOp, ChangesContent, ChangesManifest, OkCallResult } from '@dltech/atlas-protocol'
import { EChangeSide } from '@dltech/atlas-protocol'

import { newKey, type RemoteCalls } from '../../calls/remote-calls'

const CALL_DEADLINE_MS = 30_000

const call = async (args: { calls: RemoteCalls; op: CallOp }): Promise<OkCallResult> => {
  const key = newKey()
  const result = await args.calls.invoke({
    key,
    op: args.op,
    signal: AbortSignal.timeout(CALL_DEADLINE_MS),
  })
  await args.calls.ack({ key }).catch(() => undefined)
  if (result.status === 'failed') {
    throw new Error(`${args.op.op} failed: ${result.error.code} ${result.error.message}`)
  }
  return result
}

export const readScan = async (args: {
  calls: RemoteCalls
  repoPath: string
  base: string | null
}): Promise<ChangesManifest> => {
  const result = await call({
    calls: args.calls,
    op: { op: 'changes.scan', repoPath: args.repoPath, base: args.base },
  })
  if (result.op !== 'changes.scan') throw new Error(`changes.scan answered ${result.op}`)
  return result.value
}

export const readSide = async (args: {
  calls: RemoteCalls
  repoPath: string
  base: string | null
  path: string
  oldPath: string | null
  side: EChangeSide
}): Promise<ChangesContent> => {
  const result = await call({
    calls: args.calls,
    op: {
      op: 'changes.read',
      repoPath: args.repoPath,
      base: args.base,
      path: args.path,
      oldPath: args.oldPath,
      side: args.side,
    },
  })
  if (result.op !== 'changes.read') throw new Error(`changes.read answered ${result.op}`)
  return result.value
}
