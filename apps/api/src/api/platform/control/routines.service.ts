import { Injectable, NotFoundException } from '@nestjs/common'
import {
  ControlPlane,
  RoutineInvalidError,
  RoutineNotFoundError,
  routineCreateOf,
  routineListOf,
  routineRemoveOf,
  routineRunNowOf,
  routineRunsOf,
  routineUpdateOf,
} from '@dltech/atlas-control'
import {
  type Routine,
  type RoutineCreateInput,
  type RoutineListOutput,
  type RoutineRunOutput,
  type RoutineRunsOutput,
  type RoutineUpdateInput,
} from '@dltech/atlas-protocol'
import { TRPCError } from '@trpc/server'
import { ProjectAccess } from './project-access'

const refused = (failure: unknown): never => {
  if (failure instanceof RoutineInvalidError) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: failure.message })
  }
  if (failure instanceof RoutineNotFoundError) throw new NotFoundException('routine not found')
  throw failure
}

@Injectable()
export class RoutinesService {
  constructor(
    private readonly plane: ControlPlane,
    private readonly projects: ProjectAccess,
  ) {}

  private async accessibleProject(args: { userId: string; projectId: string }): Promise<void> {
    const owner = await this.projects.ownerOf({ projectId: args.projectId })
    if (owner !== args.userId) throw new NotFoundException('project not found')
  }

  async list(args: { userId: string; projectId?: string | undefined }): Promise<RoutineListOutput> {
    return await routineListOf({
      plane: this.plane,
      userId: args.userId,
      projectId: args.projectId,
    })
  }

  async create(args: { userId: string; input: RoutineCreateInput }): Promise<Routine> {
    await this.accessibleProject({ userId: args.userId, projectId: args.input.projectId })
    try {
      return await routineCreateOf({
        plane: this.plane,
        userId: args.userId,
        input: args.input,
      })
    } catch (failure) {
      return refused(failure)
    }
  }

  async update(args: { userId: string; input: RoutineUpdateInput }): Promise<Routine> {
    try {
      return await routineUpdateOf({
        plane: this.plane,
        userId: args.userId,
        input: args.input,
      })
    } catch (failure) {
      return refused(failure)
    }
  }

  async remove(args: { userId: string; routineId: string }): Promise<{ removed: boolean }> {
    return await routineRemoveOf({
      plane: this.plane,
      userId: args.userId,
      routineId: args.routineId,
    })
  }

  async runs(args: {
    userId: string
    routineId: string
    limit?: number | undefined
  }): Promise<RoutineRunsOutput> {
    try {
      return await routineRunsOf({
        plane: this.plane,
        userId: args.userId,
        routineId: args.routineId,
        limit: args.limit,
      })
    } catch (failure) {
      return refused(failure)
    }
  }

  async runNow(args: { userId: string; routineId: string }): Promise<RoutineRunOutput> {
    try {
      return await routineRunNowOf({
        plane: this.plane,
        userId: args.userId,
        routineId: args.routineId,
      })
    } catch (failure) {
      return refused(failure)
    }
  }
}
