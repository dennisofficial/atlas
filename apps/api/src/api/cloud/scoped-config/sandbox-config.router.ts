import {
  resolvedSandboxConfigSchema,
  sandboxConfigInputSchema,
  type ResolvedSandboxConfig,
  type SandboxConfigInput,
} from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { Ctx, Input, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import {
  RetiredSandboxTokenMiddleware,
  type SandboxTrpcCtx,
} from '../../platform/sandboxes/retired-sandbox-token.middleware'
import { ScopedConfigService } from './scoped-config.service'

const requestedProjectOf = (input: SandboxConfigInput): string | null => {
  const projectId = input?.projectId
  return projectId === undefined || projectId.length === 0 ? null : projectId
}

@Router({ alias: 'sandboxConfig' })
@UseMiddlewares(RetiredSandboxTokenMiddleware)
export class SandboxConfigRouter {
  constructor(private readonly scoped: ScopedConfigService) {}

  @Query({
    input: sandboxConfigInputSchema,
    output: resolvedSandboxConfigSchema,
  })
  async get(
    @Input() input: SandboxConfigInput,
    @Ctx() ctx: SandboxTrpcCtx,
  ): Promise<ResolvedSandboxConfig> {
    const thread = await db.orm.public.Thread.select('sessionId').first({
      id: ctx.sandbox.threadId,
    })
    const session =
      thread === null
        ? null
        : await db.orm.public.Session.select('projectId').first({ id: thread.sessionId })
    return this.scoped.resolveForPod({
      userId: ctx.sandbox.userId,
      projectId: session?.projectId ?? requestedProjectOf(input),
    })
  }
}
