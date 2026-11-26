import {
  memoryEditSchema,
  memoryEntrySchema,
  memoryKeySchema,
  memoryListSchema,
  memoryProjectQuerySchema,
  memoryPutSchema,
  memorySummarySchema,
  type MemoryEditWire,
  type MemoryEntry,
  type MemoryKeyWire,
  type MemoryList,
  type MemoryProjectQueryWire,
  type MemoryPutWire,
  type MemorySummary,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { MemoriesService } from './memories.service'

@Router({ alias: 'memories' })
export class MemoriesRouter {
  constructor(private readonly memories: MemoriesService) {}

  @Query({ output: memoryListSchema })
  @UseMiddlewares(SessionMiddleware)
  async listAll(@Ctx() ctx: SessionTrpcCtx): Promise<MemoryList> {
    return { memories: await this.memories.listAll({ userId: ctx.auth.userId }) }
  }

  @Query({ input: memoryProjectQuerySchema, output: memoryListSchema })
  @UseMiddlewares(SessionMiddleware)
  async list(
    @Input() input: MemoryProjectQueryWire,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<MemoryList> {
    const memories = await this.memories.list({
      userId: ctx.auth.userId,
      project: input.project,
      groupId: input.groupId,
    })
    return { memories }
  }

  @Query({ input: memoryKeySchema, output: memoryEntrySchema })
  @UseMiddlewares(SessionMiddleware)
  get(@Input() input: MemoryKeyWire, @Ctx() ctx: SessionTrpcCtx): Promise<MemoryEntry> {
    return this.memories.get({ ...input, userId: ctx.auth.userId })
  }

  @Mutation({ input: memoryPutSchema, output: memorySummarySchema })
  @UseMiddlewares(SessionMiddleware)
  put(@Input() input: MemoryPutWire, @Ctx() ctx: SessionTrpcCtx): Promise<MemorySummary> {
    return this.memories.put({ ...input, userId: ctx.auth.userId })
  }

  @Mutation({ input: memoryEditSchema, output: memorySummarySchema })
  @UseMiddlewares(SessionMiddleware)
  edit(@Input() input: MemoryEditWire, @Ctx() ctx: SessionTrpcCtx): Promise<MemorySummary> {
    return this.memories.edit({
      userId: ctx.auth.userId,
      scope: input.scope,
      project: input.project,
      groupId: input.groupId,
      name: input.name,
      old: input.old,
      replacement: input.new,
      revision: input.revision,
    })
  }

  @Mutation({ input: memoryKeySchema, output: z.void() })
  @UseMiddlewares(SessionMiddleware)
  async remove(@Input() input: MemoryKeyWire, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.memories.remove({ ...input, userId: ctx.auth.userId })
  }
}
