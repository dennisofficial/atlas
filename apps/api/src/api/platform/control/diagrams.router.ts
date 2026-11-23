import {
  diagramRepairInputSchema,
  diagramRepairListInputSchema,
  diagramRepairListOutputSchema,
  diagramRepairOutputSchema,
  type DiagramRepairInput,
  type DiagramRepairListInput,
  type DiagramRepairListOutput,
  type DiagramRepairOutput,
} from '@dltech/atlas-protocol'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { DiagramRepairService } from './diagram-repair.service'

@Router({ alias: 'diagrams' })
@UseMiddlewares(SessionMiddleware)
export class DiagramsRouter {
  constructor(private readonly diagrams: DiagramRepairService) {}

  @Mutation({ input: diagramRepairInputSchema, output: diagramRepairOutputSchema })
  repair(
    @Input() input: DiagramRepairInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<DiagramRepairOutput> {
    return this.diagrams.repair({ userId: ctx.auth.userId, input })
  }

  @Query({ input: diagramRepairListInputSchema, output: diagramRepairListOutputSchema })
  list(
    @Input() input: DiagramRepairListInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<DiagramRepairListOutput> {
    return this.diagrams.list({ userId: ctx.auth.userId, input })
  }
}
