import { Ctx, Input, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import {
  contextMirrorListInputSchema,
  contextMirrorListOutputSchema,
  contextMirrorReadInputSchema,
  contextMirrorReadOutputSchema,
  type ContextMirrorListInput,
  type ContextMirrorListOutput,
  type ContextMirrorReadInput,
  type ContextMirrorReadOutput,
} from '@dltech/atlas-protocol'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { ContextMirrorService } from './context-mirror.service'

@Router({ alias: 'contextMirror' })
@UseMiddlewares(SessionMiddleware)
export class ContextMirrorRouter {
  constructor(private readonly mirror: ContextMirrorService) {}

  @Query({ input: contextMirrorListInputSchema, output: contextMirrorListOutputSchema })
  list(
    @Input() input: ContextMirrorListInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<ContextMirrorListOutput> {
    return this.mirror.list({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: contextMirrorReadInputSchema, output: contextMirrorReadOutputSchema })
  read(
    @Input() input: ContextMirrorReadInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<ContextMirrorReadOutput> {
    return this.mirror.read({ userId: ctx.auth.userId, ...input })
  }
}
