import {
  registerPodLeaseInputSchema,
  releasePodLeaseInputSchema,
  type RegisterPodLeaseInput,
  type ReleasePodLeaseInput,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { PodLeasesService } from './pod-leases.service'

@Router({ alias: 'podLeases' })
@UseMiddlewares(SessionMiddleware)
export class PodLeasesRouter {
  constructor(private readonly leases: PodLeasesService) {}

  @Mutation({ input: registerPodLeaseInputSchema, output: z.void() })
  register(@Input() input: RegisterPodLeaseInput, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    return this.leases.register({
      userId: ctx.auth.userId,
      threadId: input.threadId,
      token: input.token,
    })
  }

  @Mutation({ input: releasePodLeaseInputSchema, output: z.void() })
  release(@Input() input: ReleasePodLeaseInput, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    return this.leases.release({ userId: ctx.auth.userId, threadId: input.threadId })
  }
}
