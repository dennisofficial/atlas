import {
  EMcpServerScope,
  mcpServerLayersSchema,
  mcpServerScopeSchema,
  personalMcpServerListSchema,
  scopedMcpServerKeySchema,
  scopedMcpServerPutSchema,
  type McpServerLayers,
  type McpServerScope,
  type PersonalMcpServerList,
  type ScopedMcpServerKey,
  type ScopedMcpServerPut,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { McpServersService } from './mcp-servers.service'

type ScopeArgs = { scope: EMcpServerScope; projectId?: string; groupId?: string }

const scopeOf = (input: McpServerScope | undefined): ScopeArgs => ({
  scope: input?.scope ?? EMcpServerScope.Personal,
  ...(input?.projectId === undefined ? {} : { projectId: input.projectId }),
  ...(input?.groupId === undefined ? {} : { groupId: input.groupId }),
})

@Router({ alias: 'mcpServers' })
@UseMiddlewares(SessionMiddleware)
export class McpServersRouter {
  constructor(private readonly servers: McpServersService) {}

  @Query({ input: mcpServerScopeSchema.optional(), output: personalMcpServerListSchema })
  async list(
    @Input() input: McpServerScope | undefined,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<PersonalMcpServerList> {
    return { servers: await this.servers.list({ userId: ctx.auth.userId, ...scopeOf(input) }) }
  }

  @Query({ input: mcpServerScopeSchema, output: mcpServerLayersSchema })
  layered(@Input() input: McpServerScope, @Ctx() ctx: SessionTrpcCtx): Promise<McpServerLayers> {
    return this.servers.layered({ userId: ctx.auth.userId, ...scopeOf(input) })
  }

  @Mutation({
    input: scopedMcpServerPutSchema,
    output: z.void(),
  })
  async put(@Input() input: ScopedMcpServerPut, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    const { name, scope, projectId, groupId, ...spec } = input
    await this.servers.put({
      userId: ctx.auth.userId,
      ...scopeOf({ scope, projectId, groupId }),
      name,
      spec,
    })
  }

  @Mutation({
    input: scopedMcpServerKeySchema,
    output: z.void(),
  })
  async remove(@Input() input: ScopedMcpServerKey, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    const { name, scope, projectId, groupId } = input
    await this.servers.remove({
      userId: ctx.auth.userId,
      ...scopeOf({ scope, projectId, groupId }),
      name,
    })
  }
}
