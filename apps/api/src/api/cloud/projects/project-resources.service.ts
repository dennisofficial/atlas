import { randomUUID } from 'node:crypto'
import type { ESecretKind, ProjectSandbox, SecretDetail } from '@dltech/atlas-wire/web'
import { projectSandboxSchema } from '@dltech/atlas-wire/web'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { assertMcpServerName, openMcpServer, sealMcpSpec } from '../mcp-servers/mcp-sealed'
import type { UpsertMcpServerDto } from '../mcp-servers/mcp-servers.dto'
import type { McpServerDto } from '../mcp-servers/mcp-servers.types'
import { assertEnvName, kindOf, openSecretValue, sealSecretValue } from '../secrets/sealed-secret'
import { PROJECT_NOT_FOUND, ProjectsService } from './projects.service'

type Scope = { userId: string; projectId: string }

@Injectable()
export class ProjectResourcesService {
  constructor(
    private readonly projects: ProjectsService,
    private readonly cipher: SecretCipherService,
  ) {}

  async readSandbox(args: Scope): Promise<ProjectSandbox> {
    const row = await this.projects.editable(args)
    return { vcpus: row.sandboxVcpus, setupScript: row.setupScript }
  }

  async writeSandbox(args: Scope & { sandbox: ProjectSandbox }): Promise<ProjectSandbox> {
    const verdict = projectSandboxSchema.safeParse(args.sandbox)
    if (!verdict.success) {
      throw new BadRequestException(verdict.error.issues[0]?.message ?? 'invalid sandbox')
    }
    await this.projects.editable(args)
    const row = await db.orm.public.Project.where({ id: args.projectId }).update({
      sandboxVcpus: args.sandbox.vcpus,
      setupScript: args.sandbox.setupScript,
    })
    if (row === null) throw new NotFoundException(PROJECT_NOT_FOUND)
    return { vcpus: row.sandboxVcpus, setupScript: row.setupScript }
  }

  async listSecrets(args: Scope): Promise<SecretDetail[]> {
    await this.projects.read(args)
    const rows = await db.orm.public.ProjectSecret.where({ projectId: args.projectId })
      .orderBy((row) => row.name.asc())
      .all()
    return rows.map((row) => ({
      name: row.name,
      kind: kindOf(row.kind),
      value: openSecretValue({ cipher: this.cipher, sealed: row.sealedValue }),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }))
  }

  async setSecret(args: Scope & { name: string; value: string; kind?: ESecretKind | undefined }): Promise<void> {
    assertEnvName(args.name)
    await this.projects.read(args)
    const sealedValue = sealSecretValue({ cipher: this.cipher, value: args.value })
    const kind = args.kind === undefined ? {} : { kind: args.kind }
    await db.orm.public.ProjectSecret.upsert({
      conflictOn: { projectId: args.projectId, name: args.name },
      create: {
        id: `psec_${randomUUID()}`,
        projectId: args.projectId,
        name: args.name,
        sealedValue,
        ...kind,
      },
      update: { sealedValue, ...kind },
    })
  }

  async removeSecret(args: Scope & { name: string }): Promise<void> {
    assertEnvName(args.name)
    await this.projects.read(args)
    await db.orm.public.ProjectSecret.where({
      projectId: args.projectId,
      name: args.name,
    }).deleteAndCount()
  }

  async listMcpServers(args: Scope): Promise<McpServerDto[]> {
    await this.projects.read(args)
    const rows = await db.orm.public.ProjectMcpServer.where({ projectId: args.projectId })
      .orderBy((row) => row.name.asc())
      .all()
    return rows.map((row) =>
      openMcpServer({ cipher: this.cipher, sealedSpec: row.sealedSpec, updatedAt: row.updatedAt }),
    )
  }

  async putMcpServer(args: Scope & { name: string; spec: UpsertMcpServerDto }): Promise<void> {
    await this.projects.read(args)
    const sealedSpec = sealMcpSpec({ cipher: this.cipher, name: args.name, spec: args.spec })
    await db.orm.public.ProjectMcpServer.upsert({
      conflictOn: { projectId: args.projectId, name: args.name },
      create: {
        id: `pmcp_${randomUUID()}`,
        projectId: args.projectId,
        name: args.name,
        sealedSpec,
      },
      update: { sealedSpec },
    })
  }

  async removeMcpServer(args: Scope & { name: string }): Promise<void> {
    assertMcpServerName(args.name)
    await this.projects.read(args)
    await db.orm.public.ProjectMcpServer.where({
      projectId: args.projectId,
      name: args.name,
    }).deleteAndCount()
  }
}
