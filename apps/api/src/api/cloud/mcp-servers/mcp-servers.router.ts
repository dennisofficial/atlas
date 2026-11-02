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
import { meta } from '../../../_module/trpc/procedure-meta'
import {
  SessionOrSandboxMiddleware,
  type SessionOrSandboxTrpcCtx,
} from '../../platform/sessions/session-or-sandbox.middleware'
import { McpServersService } from './mcp-servers.service'

@Router({ alias: 'mcpServers' })
@UseMiddlewares(SessionOrSandboxMiddleware)
export class McpServersRouter {
  constructor(private readonly servers: McpServersService) {}

  @Query({ output: personalMcpServerListSchema, meta: meta({ sandboxReachable: true }) })
  async list(@Ctx() ctx: SessionOrSandboxTrpcCtx): Promise<PersonalMcpServerList> {
    return { servers: await this.servers.list({ userId: ctx.auth.userId }) }
  }

  @Mutation({
    input: personalMcpUpsertSchema,
    output: z.void(),
    meta: meta({ sandboxReachable: true }),
  })
  async put(@Input() input: PersonalMcpUpsert, @Ctx() ctx: SessionOrSandboxTrpcCtx): Promise<void> {
    const { name, ...spec } = input
    await this.servers.put({ userId: ctx.auth.userId, name, spec })
  }

  @Mutation({
    input: personalMcpNameSchema,
    output: z.void(),
    meta: meta({ sandboxReachable: true }),
  })
  async remove(
    @Input() input: PersonalMcpName,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<void> {
    await this.servers.remove({ userId: ctx.auth.userId, name: input.name })
  }
}
