import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import {
  type Routine,
  type RoutineCreateInput,
  routineCreateInputSchema,
  type RoutineIdInput,
  routineIdInputSchema,
  type RoutineListInput,
  routineListInputSchema,
  type RoutineListOutput,
  routineListOutputSchema,
  type RoutineRemoveOutput,
  routineRemoveOutputSchema,
  type RoutineRunOutput,
  routineRunOutputSchema,
  type RoutineRunsInput,
  routineRunsInputSchema,
  type RoutineRunsOutput,
  routineRunsOutputSchema,
  routineSchema,
  type RoutineUpdateInput,
  routineUpdateInputSchema,
} from '@dltech/atlas-protocol'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { RoutinesService } from './routines.service'

@Router({ alias: 'routines' })
@UseMiddlewares(SessionMiddleware)
export class RoutinesRouter {
  constructor(private readonly routines: RoutinesService) {}

  @Query({ input: routineListInputSchema, output: routineListOutputSchema })
  list(@Input() input: RoutineListInput, @Ctx() ctx: SessionTrpcCtx): Promise<RoutineListOutput> {
    return this.routines.list({ userId: ctx.auth.userId, projectId: input.projectId })
  }

  @Query({ input: routineRunsInputSchema, output: routineRunsOutputSchema })
  runs(@Input() input: RoutineRunsInput, @Ctx() ctx: SessionTrpcCtx): Promise<RoutineRunsOutput> {
    return this.routines.runs({
      userId: ctx.auth.userId,
      routineId: input.routineId,
      limit: input.limit,
    })
  }

  @Mutation({ input: routineCreateInputSchema, output: routineSchema })
  create(@Input() input: RoutineCreateInput, @Ctx() ctx: SessionTrpcCtx): Promise<Routine> {
    return this.routines.create({ userId: ctx.auth.userId, input })
  }

  @Mutation({ input: routineUpdateInputSchema, output: routineSchema })
  update(@Input() input: RoutineUpdateInput, @Ctx() ctx: SessionTrpcCtx): Promise<Routine> {
    return this.routines.update({ userId: ctx.auth.userId, input })
  }

  @Mutation({ input: routineIdInputSchema, output: routineRemoveOutputSchema })
  remove(@Input() input: RoutineIdInput, @Ctx() ctx: SessionTrpcCtx): Promise<RoutineRemoveOutput> {
    return this.routines.remove({ userId: ctx.auth.userId, routineId: input.routineId })
  }

  @Mutation({ input: routineIdInputSchema, output: routineRunOutputSchema })
  runNow(@Input() input: RoutineIdInput, @Ctx() ctx: SessionTrpcCtx): Promise<RoutineRunOutput> {
    return this.routines.runNow({ userId: ctx.auth.userId, routineId: input.routineId })
  }
}
