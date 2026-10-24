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
import { meta } from '../../../_module/trpc/procedure-meta'
import {
  SessionOrSandboxMiddleware,
  type SessionOrSandboxTrpcCtx,
} from '../../platform/sessions/session-or-sandbox.middleware'
import { MemoriesService } from './memories.service'

const reachable = meta({ podReachable: true, sandboxReachable: true })

@Router({ alias: 'memories' })
export class MemoriesRouter {
  constructor(private readonly memories: MemoriesService) {}

  @Query({ output: memoryListSchema })
  @UseMiddlewares(SessionMiddleware)
  async listAll(@Ctx() ctx: SessionTrpcCtx): Promise<MemoryList> {
    return { memories: await this.memories.listAll({ userId: ctx.auth.userId }) }
  }

  @Query({ input: memoryProjectQuerySchema, output: memoryListSchema, meta: reachable })
  @UseMiddlewares(SessionOrSandboxMiddleware)
  async list(
    @Input() input: MemoryProjectQueryWire,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<MemoryList> {
    const memories = await this.memories.list({ userId: ctx.auth.userId, project: input.project })
    return { memories }
  }

  @Query({ input: memoryKeySchema, output: memoryEntrySchema, meta: reachable })
  @UseMiddlewares(SessionOrSandboxMiddleware)
  get(@Input() input: MemoryKeyWire, @Ctx() ctx: SessionOrSandboxTrpcCtx): Promise<MemoryEntry> {
    return this.memories.get({ ...input, userId: ctx.auth.userId })
  }

  @Mutation({ input: memoryPutSchema, output: memorySummarySchema, meta: reachable })
  @UseMiddlewares(SessionOrSandboxMiddleware)
  put(@Input() input: MemoryPutWire, @Ctx() ctx: SessionOrSandboxTrpcCtx): Promise<MemorySummary> {
    return this.memories.put({ ...input, userId: ctx.auth.userId })
  }

  @Mutation({ input: memoryEditSchema, output: memorySummarySchema, meta: reachable })
  @UseMiddlewares(SessionOrSandboxMiddleware)
  edit(
    @Input() input: MemoryEditWire,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<MemorySummary> {
    return this.memories.edit({
      userId: ctx.auth.userId,
      scope: input.scope,
      project: input.project,
      name: input.name,
      old: input.old,
      replacement: input.new,
      revision: input.revision,
    })
  }

  @Mutation({ input: memoryKeySchema, output: z.void(), meta: reachable })
  @UseMiddlewares(SessionOrSandboxMiddleware)
  async remove(@Input() input: MemoryKeyWire, @Ctx() ctx: SessionOrSandboxTrpcCtx): Promise<void> {
    await this.memories.remove({ ...input, userId: ctx.auth.userId })
  }
}
