import {
  personalMcpNameSchema,
  personalMcpServerListSchema,
  personalMcpUpsertSchema,
  type PersonalMcpName,
  type PersonalMcpServerList,
  type PersonalMcpUpsert,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { McpServersService } from './mcp-servers.service'

@Router({ alias: 'mcpServers' })
@UseMiddlewares(SessionMiddleware)
export class McpServersRouter {
  constructor(private readonly servers: McpServersService) {}

  @Query({ output: personalMcpServerListSchema })
  async list(@Ctx() ctx: SessionTrpcCtx): Promise<PersonalMcpServerList> {
    return { servers: await this.servers.list({ userId: ctx.auth.userId }) }
  }

  @Mutation({ input: personalMcpUpsertSchema, output: z.void() })
  async put(@Input() input: PersonalMcpUpsert, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    const { name, ...spec } = input
    await this.servers.put({ userId: ctx.auth.userId, name, spec })
  }

  @Mutation({ input: personalMcpNameSchema, output: z.void() })
  async remove(@Input() input: PersonalMcpName, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.servers.remove({ userId: ctx.auth.userId, name: input.name })
  }
}
