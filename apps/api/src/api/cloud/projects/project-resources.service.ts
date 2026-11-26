import { randomUUID } from 'node:crypto'
import type { ProjectSandbox, SecretSummary } from '@dltech/atlas-wire/web'
import { projectSandboxSchema } from '@dltech/atlas-wire/web'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { resolveProjectGrantId } from '../access-grants/access-grant-membership'
import { assertMcpServerName, openMcpServer, sealMcpSpec } from '../mcp-servers/mcp-sealed'
import { putCloudServer } from '../mcp-servers/mcp-servers-put'
import type { McpServerDto, McpSpecDraft } from '../mcp-servers/mcp-servers.types'
import { assertEnvName, openSecretValue, sealSecretValue } from '../secrets/sealed-secret'
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
    return {
      vcpus: row.sandboxVcpus,
      memoryGb: row.sandboxMemoryGb,
      diskGb: row.sandboxDiskGb,
      setupScript: row.setupScript,
    }
  }

  async writeSandbox(args: Scope & { sandbox: ProjectSandbox }): Promise<ProjectSandbox> {
    const verdict = projectSandboxSchema.safeParse(args.sandbox)
    if (!verdict.success) {
      throw new BadRequestException(verdict.error.issues[0]?.message ?? 'invalid sandbox')
    }
    await this.projects.editable(args)
    const row = await db.orm.public.Project.where({ id: args.projectId }).update({
      sandboxVcpus: args.sandbox.vcpus,
      sandboxMemoryGb: args.sandbox.vcpus === null ? null : args.sandbox.memoryGb,
      sandboxDiskGb: args.sandbox.diskGb,
      setupScript: args.sandbox.setupScript,
    })
    if (row === null) throw new NotFoundException(PROJECT_NOT_FOUND)
    return {
      vcpus: row.sandboxVcpus,
      memoryGb: row.sandboxMemoryGb,
      diskGb: row.sandboxDiskGb,
      setupScript: row.setupScript,
    }
  }

  async listSecrets(args: Scope): Promise<SecretSummary[]> {
    await this.projects.read(args)
    const rows = await db.orm.public.ProjectSecret.where({ projectId: args.projectId })
      .orderBy((row) => row.name.asc())
      .all()
    return rows.map((row) => ({
      name: row.name,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }))
  }

  async revealSecret(args: Scope & { name: string }): Promise<string> {
    assertEnvName(args.name)
    await this.projects.read(args)
    const row = await db.orm.public.ProjectSecret.where({
      projectId: args.projectId,
      name: args.name,
    }).first()
    if (row === null) throw new NotFoundException('secret not found')
    return openSecretValue({ cipher: this.cipher, sealed: row.sealedValue })
  }

  async setSecret(
    args: Scope & { name: string; value: string; grantId?: string | undefined },
  ): Promise<void> {
    assertEnvName(args.name)
    await this.projects.read(args)
    const sealedValue = sealSecretValue({ cipher: this.cipher, value: args.value })
    await db.transaction(async (tx) => {
      const existing = await tx.orm.public.ProjectSecret.where({
        projectId: args.projectId,
        name: args.name,
      }).first()
      const grantId = await resolveProjectGrantId({
        tx,
        projectId: args.projectId,
        requestedGrantId: args.grantId,
        existingGrantId: existing === null ? null : existing.grantId,
        label: args.name,
      })
      await tx.orm.public.ProjectSecret.upsert({
        conflictOn: { projectId: args.projectId, name: args.name },
        create: {
          id: `psec_${randomUUID()}`,
          projectId: args.projectId,
          name: args.name,
          sealedValue,
          grantId,
        },
        update: { sealedValue, grantId },
      })
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
    const rows = await db.orm.public.McpServer.where({
      projectId: args.projectId,
      source: 'cloud',
    })
      .orderBy((row) => row.name.asc())
      .all()
    return rows.map((row) => {
      if (row.sealedSpec === null) throw new Error('a cloud server row holds a sealed spec')
      return openMcpServer({
        cipher: this.cipher,
        sealedSpec: row.sealedSpec,
        updatedAt: row.updatedAt,
      })
    })
  }

  async putMcpServer(args: Scope & { name: string; spec: McpSpecDraft }): Promise<void> {
    await this.projects.read(args)
    const sealedSpec = sealMcpSpec({ cipher: this.cipher, name: args.name, spec: args.spec })
    await putCloudServer({
      cipher: this.cipher,
      scope: { projectId: args.projectId },
      idPrefix: 'pmcp_',
      name: args.name,
      sealedSpec,
    })
  }

  async removeMcpServer(args: Scope & { name: string }): Promise<void> {
    assertMcpServerName(args.name)
    await this.projects.read(args)
    await db.orm.public.McpServer.where({
      projectId: args.projectId,
      source: 'cloud',
      name: args.name,
    }).deleteAndCount()
  }
}
