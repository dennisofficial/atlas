import {
  resolvedSandboxConfigSchema,
  sandboxConfigInputSchema,
  type ResolvedSandboxConfig,
  type SandboxConfigInput,
} from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { ForbiddenException } from '@nestjs/common'
import { Ctx, Input, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { meta } from '../../../_module/trpc/procedure-meta'
import {
  SessionOrSandboxMiddleware,
  type SessionOrSandboxTrpcCtx,
} from '../../platform/sessions/session-or-sandbox.middleware'
import { ScopedConfigService } from './scoped-config.service'

const machineThreadOf = (ctx: SessionOrSandboxTrpcCtx): string => {
  const threadId = ctx.sandbox?.threadId ?? ctx.pod?.threadId
  if (threadId === undefined)
    throw new ForbiddenException('only a sandbox or pod token reads its resolved config')
  return threadId
}

const requestedProjectOf = (input: SandboxConfigInput): string | null => {
  const projectId = input?.projectId
  return projectId === undefined || projectId.length === 0 ? null : projectId
}

@Router({ alias: 'sandboxConfig' })
@UseMiddlewares(SessionOrSandboxMiddleware)
export class SandboxConfigRouter {
  constructor(private readonly scoped: ScopedConfigService) {}

  @Query({
    input: sandboxConfigInputSchema,
    output: resolvedSandboxConfigSchema,
    meta: meta({ podReachable: true, sandboxReachable: true, throttle: false }),
  })
  async get(
    @Input() input: SandboxConfigInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<ResolvedSandboxConfig> {
    const thread = await db.orm.public.Thread.select('sessionId').first({
      id: machineThreadOf(ctx),
    })
    const session =
      thread === null
        ? null
        : await db.orm.public.Session.select('projectId').first({ id: thread.sessionId })
    return this.scoped.resolveForPod({
      userId: ctx.auth.userId,
      projectId: session?.projectId ?? requestedProjectOf(input),
    })
  }
}
