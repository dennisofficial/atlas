import { randomUUID } from 'node:crypto'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { db, type Row } from '@dltech/atlas-db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import type {
  CreateAccountDto,
  OauthAuthorityDto,
  SecretDto,
  SetActiveDto,
  SetStatusDto,
} from './accounts.dto'
import type {
  AccountDto,
  AccountLeaseDto,
  AccountSecret,
  ActiveAccountDto,
  OauthAuthority,
  StoredAccountDto,
} from './accounts.types'
import { EAccountStatus, EAuthKind } from './accounts.types'

function toAccountDto(row: Row<'AgentAccount'>): AccountDto {
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

function withoutRefreshToken(secret: AccountSecret): AccountSecret {
  if (secret.kind !== EAuthKind.Oauth) return secret
  return { ...secret, tokens: { ...secret.tokens, refreshToken: '' } }
}

function toAuthority(dto: OauthAuthorityDto): OauthAuthority {
  return {
    url: dto.url,
    connectionId: dto.connectionId,
    ...(dto.generation === undefined ? {} : { generation: dto.generation }),
    ...(dto.refreshAfter === undefined ? {} : { refreshAfter: dto.refreshAfter }),
    ...(dto.authorizationId === undefined ? {} : { authorizationId: dto.authorizationId }),
    ...(dto.previousAuthorizationId === undefined
      ? {}
      : { previousAuthorizationId: dto.previousAuthorizationId }),
  }
}

function toAccountSecret(dto: SecretDto): AccountSecret {
  if (dto.kind === EAuthKind.Oauth) {
    const tokens = dto.tokens
    if (!tokens || tokens.accessToken.length === 0 || tokens.expiresAt.length === 0) {
      throw new BadRequestException('oauth secrets require tokens.accessToken and tokens.expiresAt')
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
      ...(dto.authority === undefined ? {} : { authority: toAuthority(dto.authority) }),
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
    const rows = await db.orm.public.AgentAccount.where({ userId: args.userId })
      .orderBy((account) => account.createdAt.asc())
      .all()
    return rows.map(toAccountDto)
  }

  async lease(args: { userId: string }): Promise<AccountLeaseDto> {
    const rows = await db.orm.public.AgentAccount.where({ userId: args.userId })
      .orderBy((account) => account.createdAt.asc())
      .all()
    const pointers = await db.orm.public.ActiveAccount.where({ userId: args.userId }).all()
    return {
      accounts: rows.map((row) => ({
        ...toAccountDto(row),
        secret: withoutRefreshToken(this.openSecret(row.sealedSecret)),
      })),
      active: pointers.map((pointer) => ({
        provider: pointer.provider,
        accountId: pointer.accountId,
      })),
    }
  }

  async read(args: { userId: string; accountId: string }): Promise<StoredAccountDto> {
    const row = await this.ownedRow(args)
    return { ...toAccountDto(row), secret: this.openSecret(row.sealedSecret) }
  }

  async add(args: { userId: string; draft: CreateAccountDto }): Promise<AccountDto> {
    const secret = toAccountSecret(args.draft.secret)
    const at = new Date()
    const row = await db.orm.public.AgentAccount.create({
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
      createdAt: at,
      updatedAt: at,
    })

    const pointer = await db.orm.public.ActiveAccount.first({
      userId: args.userId,
      provider: row.provider,
    })
    if (pointer === null) {
      await db.orm.public.ActiveAccount.create({
        userId: args.userId,
        provider: row.provider,
        accountId: row.id,
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
    const statement = db.raw.sql`UPDATE "AgentAccount"
      SET "sealedSecret" = ${this.sealSecret(secret)},
          "kind" = ${secret.kind},
          "status" = ${EAccountStatus.Active},
          "secretVersion" = "secretVersion" + 1,
          "updatedAt" = now()
      WHERE "id" = ${args.accountId}`
      .affectedCount()
      .build()
    await db.execute(statement)
  }

  async setStatus(args: {
    userId: string
    accountId: string
    status: SetStatusDto
  }): Promise<void> {
    await this.ownedRow(args)
    await db.orm.public.AgentAccount.where({ id: args.accountId }).update({
      status: args.status.status,
    })
  }

  async remove(args: { userId: string; accountId: string }): Promise<void> {
    await this.ownedRow(args)
    await db.orm.public.AgentAccount.where({ id: args.accountId }).delete()
  }

  async setActive(args: { userId: string; draft: SetActiveDto }): Promise<void> {
    await this.ownedRow({ userId: args.userId, accountId: args.draft.accountId })
    await db.orm.public.ActiveAccount.upsert({
      create: {
        userId: args.userId,
        provider: args.draft.provider,
        accountId: args.draft.accountId,
      },
      update: { accountId: args.draft.accountId },
      conflictOn: { userId: args.userId, provider: args.draft.provider },
    })
  }

  async activeFor(args: { userId: string; provider: string }): Promise<ActiveAccountDto> {
    const pointer = await db.orm.public.ActiveAccount.first({
      userId: args.userId,
      provider: args.provider,
    })
    return { accountId: pointer?.accountId ?? null }
  }

  private async ownedRow(args: {
    userId: string
    accountId: string
  }): Promise<Row<'AgentAccount'>> {
    const row = await db.orm.public.AgentAccount.first({
      id: args.accountId,
      userId: args.userId,
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
