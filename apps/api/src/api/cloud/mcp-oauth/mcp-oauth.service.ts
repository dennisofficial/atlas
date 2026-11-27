import { EMcpServerSource, type McpOauthServer } from '@dltech/atlas-wire'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { toWireMcpOauthServer } from './mcp-oauth-server-view'
import { McpOauthStore } from './mcp-oauth.types'
import type { ServerGrantRow } from './mcp-oauth.types'

const PROJECT_NOT_FOUND_MESSAGE = 'project not found'
const GROUP_NOT_FOUND_MESSAGE = 'group not found'
const SERVER_NOT_FOUND = 'mcp server not found'

@Injectable()
export class McpOauthService {
  constructor(
    private readonly store: McpOauthStore,
    private readonly cipher: SecretCipherService,
  ) {}

  async servers(args: {
    userId: string
    projectId?: string | undefined
    groupId?: string | undefined
  }): Promise<McpOauthServer[]> {
    const rows = await this.store.listServers(
      await this.scopeOf({
        userId: args.userId,
        ...(args.projectId === undefined ? {} : { projectId: args.projectId }),
        ...(args.groupId === undefined ? {} : { groupId: args.groupId }),
      }),
    )
    return rows.map((row) => toWireMcpOauthServer({ cipher: this.cipher, row }))
  }

  async disconnect(args: { userId: string; serverId: string }): Promise<void> {
    const row = await this.ownedServer(args)
    await this.store.clearGrant({ id: row.id })
  }

  async forget(args: { userId: string; serverId: string }): Promise<void> {
    const row = await this.ownedServer(args)
    if (row.source !== EMcpServerSource.Repo) {
      throw new BadRequestException('remove cloud servers from the MCP list')
    }
    await this.store.deleteRepoServer({ id: row.id })
  }

  private async ownedServer(args: { userId: string; serverId: string }): Promise<ServerGrantRow> {
    const row = await this.store.findServer({ id: args.serverId })
    if (row === null) throw new NotFoundException(SERVER_NOT_FOUND)
    if (row.userId === args.userId) return row
    if (
      row.projectId !== null &&
      (await this.store.projectOwner({ projectId: row.projectId })) === args.userId
    ) {
      return row
    }
    if (
      row.groupId !== null &&
      (await this.store.groupOwner({ groupId: row.groupId })) === args.userId
    ) {
      return row
    }
    throw new NotFoundException(SERVER_NOT_FOUND)
  }

  private async scopeOf(args: {
    userId: string
    projectId?: string | undefined
    groupId?: string | undefined
  }): Promise<{ userId: string } | { groupId: string } | { projectId: string }> {
    if (args.projectId !== undefined) {
      return {
        projectId: await this.ownedProject({ userId: args.userId, projectId: args.projectId }),
      }
    }
    if (args.groupId !== undefined) {
      return { groupId: await this.ownedGroup({ userId: args.userId, groupId: args.groupId }) }
    }
    return { userId: args.userId }
  }

  private async ownedProject(args: { userId: string; projectId: string }): Promise<string> {
    const owner = await this.store.projectOwner({ projectId: args.projectId })
    if (owner !== args.userId) throw new NotFoundException(PROJECT_NOT_FOUND_MESSAGE)
    return args.projectId
  }

  private async ownedGroup(args: { userId: string; groupId: string }): Promise<string> {
    const owner = await this.store.groupOwner({ groupId: args.groupId })
    if (owner !== args.userId) throw new NotFoundException(GROUP_NOT_FOUND_MESSAGE)
    return args.groupId
  }
}
