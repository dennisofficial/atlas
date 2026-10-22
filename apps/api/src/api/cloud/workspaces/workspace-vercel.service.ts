import type {
  WorkspaceVercelCredential,
  WorkspaceVercelCredentialUpsert,
} from '@dltech/atlas-wire/web'
import { workspaceVercelCredentialUpsertSchema } from '@dltech/atlas-wire/web'
import { BadRequestException, Injectable } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { openSecretValue, sealSecretValue } from '../secrets/sealed-secret'
import { WorkspaceAccessService } from './workspace-access.service'

type Scope = { userId: string; organizationId: string }

const UNCONFIGURED: WorkspaceVercelCredential = { configured: false, teamId: null, updatedAt: null }

@Injectable()
export class WorkspaceVercelService {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly cipher: SecretCipherService,
  ) {}

  async read(args: Scope): Promise<WorkspaceVercelCredential> {
    await this.access.require({ ...args, write: false })
    const row = await db.orm.public.WorkspaceVercelCredential.first({
      organizationId: args.organizationId,
    })
    if (row === null) return UNCONFIGURED
    return { configured: true, teamId: row.teamId, updatedAt: row.updatedAt.toISOString() }
  }

  async write(args: Scope & { body: unknown }): Promise<void> {
    const parsed = workspaceVercelCredentialUpsertSchema.safeParse(args.body)
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'invalid vercel credential')
    }
    await this.access.require({
      userId: args.userId,
      organizationId: args.organizationId,
      write: true,
    })
    await this.upsert({ ...args, input: parsed.data })
  }

  async remove(args: Scope): Promise<void> {
    await this.access.require({ ...args, write: true })
    await db.orm.public.WorkspaceVercelCredential.where({
      organizationId: args.organizationId,
    }).deleteAndCount()
  }

  async openToken(args: {
    organizationId: string
  }): Promise<{ token: string; teamId: string } | null> {
    const row = await db.orm.public.WorkspaceVercelCredential.first({
      organizationId: args.organizationId,
    })
    if (row === null) return null
    return {
      token: openSecretValue({ cipher: this.cipher, sealed: row.sealedToken }),
      teamId: row.teamId,
    }
  }

  private async upsert(args: Scope & { input: WorkspaceVercelCredentialUpsert }): Promise<void> {
    const { organizationId, userId, input } = args
    if (input.token === undefined) {
      const count = await db.orm.public.WorkspaceVercelCredential.where({
        organizationId,
      }).updateAndCount({ teamId: input.teamId, updatedById: userId })
      if (count === 0) throw new BadRequestException('a token is required the first time')
      return
    }
    const sealedToken = sealSecretValue({ cipher: this.cipher, value: input.token })
    await db.orm.public.WorkspaceVercelCredential.upsert({
      conflictOn: { organizationId },
      create: { organizationId, sealedToken, teamId: input.teamId, updatedById: userId },
      update: { sealedToken, teamId: input.teamId, updatedById: userId },
    })
  }
}
