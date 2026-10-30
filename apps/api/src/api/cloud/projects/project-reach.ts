import { db } from '@dltech/atlas-db'
import { ForbiddenException } from '@nestjs/common'
import { assertFreshSession } from '../../../_module/session/fresh-session'
import type { SessionOrSandboxTrpcCtx } from '../../platform/sessions/session-or-sandbox.middleware'

export const assertProjectReach = async (args: {
  ctx: SessionOrSandboxTrpcCtx
  projectId: string
}): Promise<void> => {
  const { sandbox } = args.ctx
  if (sandbox === undefined) return
  const thread = await db.orm.public.Thread.select('sessionId').first({ id: sandbox.threadId })
  const session =
    thread === null
      ? null
      : await db.orm.public.Session.select('projectId').first({ id: thread.sessionId })
  if (session === null || session.projectId !== args.projectId) {
    throw new ForbiddenException('a sandbox token reaches only its own project')
  }
}

export const assertRevealAllowed = (args: { ctx: SessionOrSandboxTrpcCtx }): void => {
  if (args.ctx.sandbox !== undefined) return
  assertFreshSession({ auth: args.ctx.auth })
}
