import { randomUUID } from 'node:crypto'
import type { FileMountSummary } from '@dltech/atlas-wire/web'
import { Injectable, NotFoundException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import {
  cleanupProjectGrant,
  resolveProjectGrantId,
} from '../access-grants/access-grant-membership'
import { openSecretValue, sealSecretValue } from '../secrets/sealed-secret'
import { ProjectsService } from './projects.service'

type Scope = { userId: string; projectId: string }

@Injectable()
export class ProjectFileMountsService {
  constructor(
    private readonly projects: ProjectsService,
    private readonly cipher: SecretCipherService,
  ) {}

  async list(args: Scope): Promise<FileMountSummary[]> {
    await this.projects.read(args)
    const rows = await db.orm.public.ProjectFileMount.where({ projectId: args.projectId })
      .orderBy((row) => row.path.asc())
      .all()
    return rows.map((row) => ({
      path: row.path,
      mode: row.mode,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }))
  }

  async reveal(args: Scope & { path: string }): Promise<string> {
    await this.projects.read(args)
    const row = await db.orm.public.ProjectFileMount.where({
      projectId: args.projectId,
      path: args.path,
    }).first()
    if (row === null) throw new NotFoundException('file mount not found')
    return openSecretValue({ cipher: this.cipher, sealed: row.sealedContents })
  }

  async set(
    args: Scope & {
      path: string
      contents: string
      mode: number
      grantId?: string | undefined
    },
  ): Promise<void> {
    await this.projects.read(args)
    const sealedContents = sealSecretValue({ cipher: this.cipher, value: args.contents })
    await db.transaction(async (tx) => {
      const existing = await tx.orm.public.ProjectFileMount.where({
        projectId: args.projectId,
        path: args.path,
      }).first()
      const grantId = await resolveProjectGrantId({
        tx,
        projectId: args.projectId,
        requestedGrantId: args.grantId,
        existingGrantId: existing === null ? null : existing.grantId,
        label: args.path,
      })
      await tx.orm.public.ProjectFileMount.upsert({
        conflictOn: { projectId: args.projectId, path: args.path },
        create: {
          id: `pfm_${randomUUID()}`,
          projectId: args.projectId,
          path: args.path,
          sealedContents,
          mode: args.mode,
          grantId,
        },
        update: { sealedContents, mode: args.mode, grantId },
      })
      if (existing !== null && existing.grantId !== grantId) {
        await cleanupProjectGrant({
          tx,
          projectId: args.projectId,
          grantId: existing.grantId,
        })
      }
    })
  }

  async remove(args: Scope & { path: string }): Promise<void> {
    await this.projects.read(args)
    await db.transaction(async (tx) => {
      const existing = await tx.orm.public.ProjectFileMount.where({
        projectId: args.projectId,
        path: args.path,
      }).first()
      if (existing === null) return
      await tx.orm.public.ProjectFileMount.where({
        projectId: args.projectId,
        path: args.path,
      }).deleteAndCount()
      await cleanupProjectGrant({
        tx,
        projectId: args.projectId,
        grantId: existing.grantId,
      })
    })
  }
}
