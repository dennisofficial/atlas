import { randomUUID } from 'node:crypto'
import type { ESecretKind, WorkspaceSecret } from '@dltech/atlas-wire/web'
import { Injectable } from '@nestjs/common'
import { db } from '../../../db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { assertMcpServerName, openMcpServer, sealMcpSpec } from '../mcp-servers/mcp-sealed'
import type { UpsertMcpServerDto } from '../mcp-servers/mcp-servers.dto'
import type { McpServerDto } from '../mcp-servers/mcp-servers.types'
import { assertEnvName, kindOf, openSecretValue, sealSecretValue } from '../secrets/sealed-secret'
import { WorkspaceAccessService } from './workspace-access.service'

type Scope = { userId: string; organizationId: string }

@Injectable()
export class WorkspaceResourcesService {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly cipher: SecretCipherService,
  ) {}

  async listSecrets(args: Scope): Promise<WorkspaceSecret[]> {
    await this.access.require({ ...args, write: false })
    const rows = await db.workspaceSecret.findMany({
      where: { organizationId: args.organizationId },
      orderBy: { name: 'asc' },
    })
    const updaterIds = [
      ...new Set(rows.flatMap((row) => (row.updatedById ? [row.updatedById] : []))),
    ]
    const users = await db.user.findMany({
      where: { id: { in: updaterIds } },
      select: { id: true, name: true },
    })
    const nameById = new Map(users.map((user) => [user.id, user.name]))
    return rows.map((row) => {
      const updaterName = row.updatedById ? nameById.get(row.updatedById) : undefined
      return {
        name: row.name,
        kind: kindOf(row.kind),
        value: openSecretValue({ cipher: this.cipher, sealed: row.sealedValue }),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        updatedBy:
          row.updatedById && updaterName !== undefined
            ? { userId: row.updatedById, name: updaterName }
            : null,
      }
    })
  }

  async setSecret(
    args: Scope & { name: string; value: string; kind?: ESecretKind | undefined },
  ): Promise<void> {
    assertEnvName(args.name)
    await this.access.require({ ...args, write: true })
    const sealedValue = sealSecretValue({ cipher: this.cipher, value: args.value })
    const kind = args.kind === undefined ? {} : { kind: args.kind }
    await db.workspaceSecret.upsert({
      where: {
        organizationId_name: { organizationId: args.organizationId, name: args.name },
      },
      create: {
        id: `wsec_${randomUUID()}`,
        organizationId: args.organizationId,
        name: args.name,
        sealedValue,
        updatedById: args.userId,
        ...kind,
      },
      update: { sealedValue, updatedById: args.userId, ...kind },
    })
  }

  async removeSecret(args: Scope & { name: string }): Promise<void> {
    assertEnvName(args.name)
    await this.access.require({ ...args, write: true })
    await db.workspaceSecret.deleteMany({
      where: { organizationId: args.organizationId, name: args.name },
    })
  }

  async listMcpServers(args: Scope): Promise<McpServerDto[]> {
    await this.access.require({ ...args, write: false })
    const rows = await db.workspaceMcpServer.findMany({
      where: { organizationId: args.organizationId },
      orderBy: { name: 'asc' },
    })
    return rows.map((row) =>
      openMcpServer({ cipher: this.cipher, sealedSpec: row.sealedSpec, updatedAt: row.updatedAt }),
    )
  }

  async putMcpServer(args: Scope & { name: string; spec: UpsertMcpServerDto }): Promise<void> {
    await this.access.require({ ...args, write: true })
    const sealedSpec = sealMcpSpec({ cipher: this.cipher, name: args.name, spec: args.spec })
    await db.workspaceMcpServer.upsert({
      where: {
        organizationId_name: { organizationId: args.organizationId, name: args.name },
      },
      create: {
        id: `wmcp_${randomUUID()}`,
        organizationId: args.organizationId,
        name: args.name,
        sealedSpec,
      },
      update: { sealedSpec },
    })
  }

  async removeMcpServer(args: Scope & { name: string }): Promise<void> {
    assertMcpServerName(args.name)
    await this.access.require({ ...args, write: true })
    await db.workspaceMcpServer.deleteMany({
      where: { organizationId: args.organizationId, name: args.name },
    })
  }
}
