import { CallFailureError, ECallFailure, EChangeSide } from '@dltech/atlas-protocol'
import type { ChangesContent, ChangesReadOp } from '@dltech/atlas-protocol'

import type { DaemonOpsDeps } from '../deps'
import { EMPTY_TREE, baseSide, currentSide, resolveBase } from './sides'

const notFound = (message: string): CallFailureError =>
  new CallFailureError({ code: ECallFailure.NotFound, message })

export const readChangeSide = async (args: {
  deps: DaemonOpsDeps
  op: ChangesReadOp
}): Promise<ChangesContent> => {
  const { deps, op } = args
  const resolved = await resolveBase({ deps, repoPath: op.repoPath, base: op.base })
  const side =
    op.side === EChangeSide.Base
      ? await baseSide({
          deps,
          repoPath: op.repoPath,
          ref: resolved ?? EMPTY_TREE,
          path: op.oldPath ?? op.path,
        })
      : await currentSide({ repoPath: op.repoPath, path: op.path })
  if (side === null || side === 'directory') throw notFound(`${op.path} has no ${op.side} content`)
  return {
    hash: side.hash,
    size: side.size,
    base64: Buffer.from(side.bytes).toString('base64'),
  }
}
