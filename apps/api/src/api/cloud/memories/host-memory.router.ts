import {
  EMemoryScope,
  memoryHostAddressSchema,
  memoryHostEditSchema,
  memoryHostEntrySchema,
  memoryHostListSchema,
  memoryHostRemovedSchema,
  memoryHostSummarySchema,
  memoryHostThreadSchema,
  memoryHostWriteSchema,
  type MemoryEntry,
  type MemoryHostAddressWire,
  type MemoryHostEditWire,
  type MemoryHostListWire,
  type MemoryHostRemovedWire,
  type MemoryHostSummaryWire,
  type MemoryHostWriteWire,
} from '@dltech/atlas-wire'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Input, Mutation, Router, UseMiddlewares } from 'nestjs-trpc'
import { HostTokenMiddleware } from '../../platform/host/host-token.middleware'
import { v2ThreadOwnerOf } from '../../platform/sandboxes/v2-thread-owner'
import { MemoriesService } from './memories.service'

const projectFor = (args: { scope: EMemoryScope; project: string | null }): string | undefined => {
  if (args.scope === EMemoryScope.Global) return undefined
  if (args.project === null) {
    throw new BadRequestException(
      'this session has no GitHub repository, so only global memory is available',
    )
  }
  return args.project
}

const entryOrNull = async (read: () => Promise<MemoryEntry>): Promise<MemoryEntry | null> => {
  try {
    return await read()
  } catch (failure) {
    if (failure instanceof NotFoundException) return null
    throw failure
  }
}

const removedOf = async (remove: () => Promise<void>): Promise<boolean> => {
  try {
    await remove()
    return true
  } catch (failure) {
    if (failure instanceof NotFoundException) return false
    throw failure
  }
}

@Router({ alias: 'hostMemory' })
@UseMiddlewares(HostTokenMiddleware)
export class HostMemoryRouter {
  constructor(private readonly memories: MemoriesService) {}

  @Mutation({ input: memoryHostThreadSchema, output: memoryHostListSchema })
  async list(@Input() input: { threadId: string }): Promise<MemoryHostListWire> {
    const owner = await v2ThreadOwnerOf(input.threadId)
    return {
      project: owner.project,
      memories: await this.memories.list({
        userId: owner.userId,
        project: owner.project ?? undefined,
      }),
    }
  }

  @Mutation({ input: memoryHostAddressSchema, output: memoryHostEntrySchema })
  async get(@Input() input: MemoryHostAddressWire): Promise<{ memory: MemoryEntry | null }> {
    const owner = await v2ThreadOwnerOf(input.threadId)
    const memory = await entryOrNull(() =>
      this.memories.get({
        userId: owner.userId,
        scope: input.scope,
        name: input.name,
        project: projectFor({ scope: input.scope, project: owner.project }),
      }),
    )
    return { memory }
  }

  @Mutation({ input: memoryHostWriteSchema, output: memoryHostSummarySchema })
  async write(@Input() input: MemoryHostWriteWire): Promise<MemoryHostSummaryWire> {
    const owner = await v2ThreadOwnerOf(input.threadId)
    const memory = await this.memories.put({
      userId: owner.userId,
      scope: input.scope,
      name: input.name,
      project: projectFor({ scope: input.scope, project: owner.project }),
      description: input.description,
      type: input.type,
      body: input.body,
    })
    return { memory }
  }

  @Mutation({ input: memoryHostEditSchema, output: memoryHostSummarySchema })
  async edit(@Input() input: MemoryHostEditWire): Promise<MemoryHostSummaryWire> {
    const owner = await v2ThreadOwnerOf(input.threadId)
    const memory = await this.memories.edit({
      userId: owner.userId,
      scope: input.scope,
      name: input.name,
      project: projectFor({ scope: input.scope, project: owner.project }),
      old: input.old,
      replacement: input.new,
      revision: input.revision,
    })
    return { memory }
  }

  @Mutation({ input: memoryHostAddressSchema, output: memoryHostRemovedSchema })
  async remove(@Input() input: MemoryHostAddressWire): Promise<MemoryHostRemovedWire> {
    const owner = await v2ThreadOwnerOf(input.threadId)
    const removed = await removedOf(() =>
      this.memories.remove({
        userId: owner.userId,
        scope: input.scope,
        name: input.name,
        project: projectFor({ scope: input.scope, project: owner.project }),
      }),
    )
    return { removed }
  }
}
