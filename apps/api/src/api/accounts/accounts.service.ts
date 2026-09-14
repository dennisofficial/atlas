import { randomUUID } from 'node:crypto'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { AgentAccountModel } from '@db'
import { db } from '@db'
import { SecretCipherService } from '@lib/crypto/secret-cipher.service'
import type { CreateAccountDto, SecretDto, SetActiveDto, SetStatusDto } from './accounts.dto'
import type {
  AccountDto,
  AccountSecret,
  ActiveAccountDto,
  StoredAccountDto,
} from './accounts.types'
import { EAccountStatus, EAuthKind } from './accounts.types'

function toAccountDto(row: AgentAccountModel): AccountDto {
  return {
    id: row.id,
    provider: row.provider,
    kind: row.kind,
    origin: row.origin,
    label: row.label,
    status: row.status,
    ...(row.email === null ? {} : { email: row.email }),
    ...(row.subscription === null ? {} : { subscription: row.subscription }),
    ...(row.importedFrom === null ? {} : { importedFrom: row.importedFrom }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toAccountSecret(dto: SecretDto): AccountSecret {
  if (dto.kind === EAuthKind.Oauth) {
    const tokens = dto.tokens
    if (!tokens || tokens.accessToken.length === 0 || tokens.expiresAt.length === 0) {
      throw new BadRequestException(
        'oauth secrets require tokens.accessToken and tokens.expiresAt',
      )
    }
    return {
      kind: EAuthKind.Oauth,
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        ...(tokens.scopes === undefined ? {} : { scopes: tokens.scopes }),
        ...(tokens.accountId === undefined ? {} : { accountId: tokens.accountId }),
      },
    }
  }
  if (dto.kind === EAuthKind.ApiKey) {
    if (dto.apiKey === undefined || dto.apiKey.length === 0) {
      throw new BadRequestException('api-key secrets require a non-empty apiKey')
    }
    return { kind: EAuthKind.ApiKey, apiKey: dto.apiKey }
  }
  throw new BadRequestException('unknown secret kind')
}

@Injectable()
export class AccountsService {
  constructor(private readonly cipher: SecretCipherService) {}

  async list(args: { userId: string }): Promise<AccountDto[]> {
    const rows = await db.agentAccount.findMany({
      where: { userId: args.userId },
      orderBy: { createdAt: 'asc' },
    })
    return rows.map(toAccountDto)
  }

  async read(args: { userId: string; accountId: string }): Promise<StoredAccountDto> {
    const row = await this.ownedRow(args)
    return { ...toAccountDto(row), secret: this.openSecret(row.sealedSecret) }
  }

  async add(args: { userId: string; draft: CreateAccountDto }): Promise<AccountDto> {
    const secret = toAccountSecret(args.draft.secret)
    const row = await db.agentAccount.create({
      data: {
        id: `acc_${randomUUID()}`,
        provider: args.draft.provider,
        kind: secret.kind,
        origin: args.draft.origin,
        label: args.draft.label,
        status: EAccountStatus.Active,
        email: args.draft.email ?? null,
        subscription: args.draft.subscription ?? null,
        importedFrom: args.draft.importedFrom ?? null,
        sealedSecret: this.sealSecret(secret),
        userId: args.userId,
      },
    })

    const pointer = await db.activeAccount.findUnique({
      where: { userId_provider: { userId: args.userId, provider: row.provider } },
    })
    if (pointer === null) {
      await db.activeAccount.create({
        data: { userId: args.userId, provider: row.provider, accountId: row.id },
      })
    }

    return toAccountDto(row)
  }

  async replaceSecret(args: {
    userId: string
    accountId: string
    secret: SecretDto
  }): Promise<void> {
    await this.ownedRow(args)
    const secret = toAccountSecret(args.secret)
    await db.agentAccount.update({
      where: { id: args.accountId },
      data: {
        sealedSecret: this.sealSecret(secret),
        kind: secret.kind,
        status: EAccountStatus.Active,
      },
    })
  }

  async setStatus(args: { userId: string; accountId: string; status: SetStatusDto }): Promise<void> {
    await this.ownedRow(args)
    await db.agentAccount.update({
      where: { id: args.accountId },
      data: { status: args.status.status },
    })
  }

  async remove(args: { userId: string; accountId: string }): Promise<void> {
    await this.ownedRow(args)
    await db.agentAccount.delete({ where: { id: args.accountId } })
    await db.activeAccount.deleteMany({
      where: { userId: args.userId, accountId: args.accountId },
    })
  }

  async setActive(args: { userId: string; draft: SetActiveDto }): Promise<void> {
    await this.ownedRow({ userId: args.userId, accountId: args.draft.accountId })
    await db.activeAccount.upsert({
      where: { userId_provider: { userId: args.userId, provider: args.draft.provider } },
      create: {
        userId: args.userId,
        provider: args.draft.provider,
        accountId: args.draft.accountId,
      },
      update: { accountId: args.draft.accountId },
    })
  }

  async activeFor(args: { userId: string; provider: string }): Promise<ActiveAccountDto> {
    const pointer = await db.activeAccount.findUnique({
      where: { userId_provider: { userId: args.userId, provider: args.provider } },
    })
    return { accountId: pointer?.accountId ?? null }
  }

  private async ownedRow(args: {
    userId: string
    accountId: string
  }): Promise<AgentAccountModel> {
    const row = await db.agentAccount.findFirst({
      where: { id: args.accountId, userId: args.userId },
    })
    if (row === null) throw new NotFoundException('account not found')
    return row
  }

  private sealSecret(secret: AccountSecret): string {
    return this.cipher.encrypt(JSON.stringify(secret))
  }

  private openSecret(sealedSecret: string): AccountSecret {
    return JSON.parse(this.cipher.decrypt(sealedSecret)) as AccountSecret
  }
}
