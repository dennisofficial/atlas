import type { ControlPlane } from '@dltech/atlas-control'
import {
  ECallStatus,
  EChangeFileStatus,
  type CallOp,
  type CallResult,
} from '@dltech/atlas-protocol'

import { FilesService } from './files.service'
import type { PodOps } from '../../../agent'
import { setupSessionsService as setup } from './sessions.service.fixture'

export const CHECKOUT_ROOT = '/atlas/workspaces/app'

export const ok = (result: CallResult): Awaited<ReturnType<PodOps['invoke']>> => ({
  state: 'ok',
  result,
})

export const opsOf = (results: CallResult[], seen: CallOp[] = []): PodOps => ({
  async invoke(args) {
    seen.push(args.op)
    const next = results.shift()
    if (next === undefined) throw new Error('no result staged')
    return ok(next)
  },
  events: () => null,
  hold: () => true,
})

export const listing = (names: readonly string[]): CallResult => ({
  status: ECallStatus.Ok,
  op: 'readDirectory',
  value: names.map((name) => ({ name, isFile: true, isDirectory: false })),
})

export const stageCheckout = (args: {
  plane: ControlPlane
  sessionId: string
  checkoutId: string
  worktreePath: string
  updatedAt: number
  paths: readonly string[]
}): Promise<void> =>
  args.plane.upsertChanges({
    sessionId: args.sessionId,
    write: {
      checkoutId: args.checkoutId,
      sessionId: args.sessionId,
      repo: 'app',
      worktreePath: args.worktreePath,
      base: null,
      fingerprint: 'f1',
      updatedAt: args.updatedAt,
      files: args.paths.map((path) => ({
        path,
        oldPath: null,
        status: EChangeFileStatus.Modified,
        additions: 1,
        deletions: 0,
        binary: false,
        baseHash: null,
        currentHash: null,
        size: 1,
      })),
    },
    blobs: [],
  })

export const setupFiles = (ops: PodOps) => {
  const { plane, service: sessions } = setup()
  return { plane, sessions, files: new FilesService(plane, sessions, ops) }
}

export const asUser = async (sessions: ReturnType<typeof setup>['service']): Promise<string> => {
  const created = await sessions.create({ userId: 'user-a', projectId: 'proj-a' })
  return created.sessionId
}
