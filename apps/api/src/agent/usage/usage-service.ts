import {
  EAuthKind,
  EAuthProvider,
  EUsageWindow,
  NO_USAGE,
  UNMETERED,
  type AccountUsage,
  toAccountId,
  type UsageReport,
} from '@dltech/atlas-core'
import { authProviderOf } from '@dltech/atlas-credentials'
import {
  AnthropicUsageClient,
  CodexUsageClient,
  type UsageClient,
} from '@dltech/atlas-credentials/usage'
import type { UsageReportDto, UsageWindowDto } from '@dltech/atlas-protocol'
import type { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'
import { NotFoundException } from '@nestjs/common'

import type { ModelTokenService } from '../tokens/model-token-service'
import { PlanCredential } from './plan-credential'
import type { UsageAccountRow, UsageAccounts } from './usage-accounts'

export const USAGE_FLOOR_MS = 20_000

export type UsageReportRequest =
  | { userId: string; accountId: string }
  | { userId: string; provider: EAuthProvider }

type Cached = UsageReport & { atMs: number }

const windowOf = (
  reading: AccountUsage | typeof UNMETERED,
  window: EUsageWindow,
): UsageWindowDto | null => {
  if (reading === UNMETERED) return null
  const found = reading[window]
  return found === null ? null : { utilization: found.utilization, resetsAt: found.resetsAt }
}

const labelOf = (row: UsageAccountRow | null): string | null =>
  row === null ? null : (row.email ?? row.label)

const unmeteredOf = (row: UsageAccountRow | null): UsageReportDto => ({
  accountId: row?.id ?? null,
  label: labelOf(row),
  metered: false,
  fiveHour: null,
  sevenDay: null,
  fetchedAt: null,
})

export class UsageService {
  private readonly cache = new Map<string, Cached>()
  private readonly inflight = new Map<string, Promise<AccountUsage | null>>()
  private readonly now: () => number

  constructor(
    private readonly args: {
      accounts: UsageAccounts
      tokens: Pick<ModelTokenService, 'issue'>
      cipher: Pick<SecretCipher, 'decrypt'>
      fetch?: typeof globalThis.fetch | undefined
      now?: (() => number) | undefined
      clientVersions: { anthropic: string; codex: string }
    },
  ) {
    this.now = args.now ?? Date.now
  }

  async report(request: UsageReportRequest): Promise<UsageReportDto> {
    const row =
      'accountId' in request
        ? await this.owned(request)
        : await this.args.accounts.chosen({
            userId: request.userId,
            provider: request.provider,
          })
    if (row === null || !this.meteredOf({ userId: request.userId, row })) return unmeteredOf(row)
    const cached = await this.cached({ userId: request.userId, row })
    return {
      accountId: row.id,
      label: labelOf(row),
      metered: true,
      fiveHour: windowOf(cached.reading, EUsageWindow.FiveHour),
      sevenDay: windowOf(cached.reading, EUsageWindow.SevenDay),
      fetchedAt: cached.fetchedAt,
    }
  }

  async refresh(args: { userId: string; accountId: string }): Promise<void> {
    try {
      const row = await this.args.accounts.owned(args)
      if (row === null || !this.meteredOf({ userId: args.userId, row })) return
      await this.cached({ userId: args.userId, row })
    } catch {
      return
    }
  }

  async refreshAfterTurn(args: { sessionId: string }): Promise<void> {
    try {
      const owner = await this.args.accounts.sessionOwner({ sessionId: args.sessionId })
      if (owner === null || owner.provider === undefined) return
      const row = await this.args.accounts.chosen({
        userId: owner.userId,
        provider: owner.provider,
      })
      if (row === null) return
      await this.refresh({ userId: owner.userId, accountId: row.id })
    } catch {
      return
    }
  }

  private async owned(request: { userId: string; accountId: string }): Promise<UsageAccountRow> {
    const row = await this.args.accounts.owned(request)
    if (row === null) throw new NotFoundException('account not found')
    return row
  }

  private async cached(args: { userId: string; row: UsageAccountRow }): Promise<Cached> {
    const previous = this.cache.get(args.row.id)
    if (previous !== undefined && this.now() - previous.atMs < USAGE_FLOOR_MS) return previous
    const reading = await this.sharedRead(args)
    const atMs = this.now()
    const next: Cached =
      reading === null
        ? {
            reading: previous?.reading ?? NO_USAGE,
            fetchedAt: previous?.fetchedAt ?? null,
            atMs,
          }
        : { reading, fetchedAt: new Date(atMs).toISOString(), atMs }
    this.cache.set(args.row.id, next)
    return next
  }

  private async sharedRead(args: {
    userId: string
    row: UsageAccountRow
  }): Promise<AccountUsage | null> {
    const running = this.inflight.get(args.row.id)
    if (running !== undefined) return running
    const client = this.clientOf(args)
    if (client === undefined) return null
    const pending = client.read({ accountId: toAccountId(args.row.id) }).catch(() => null)
    this.inflight.set(args.row.id, pending)
    try {
      return await pending
    } finally {
      this.inflight.delete(args.row.id)
    }
  }

  private meteredOf(args: { userId: string; row: UsageAccountRow }): boolean {
    return args.row.kind === EAuthKind.Oauth && this.clientOf(args) !== undefined
  }

  private clientOf(args: { userId: string; row: UsageAccountRow }): UsageClient | undefined {
    const provider = authProviderOf(args.row.provider)
    if (provider !== EAuthProvider.Anthropic && provider !== EAuthProvider.OpenAI) return undefined
    const credentials = new PlanCredential({
      userId: args.userId,
      row: args.row,
      cipher: this.args.cipher,
      tokens: this.args.tokens,
    })
    const fetch = this.args.fetch
    if (provider === EAuthProvider.Anthropic)
      return new AnthropicUsageClient({
        credentials,
        clientVersion: this.args.clientVersions.anthropic,
        ...(fetch === undefined ? {} : { fetch }),
      })
    return new CodexUsageClient({
      credentials,
      clientVersion: this.args.clientVersions.codex,
      now: this.now,
      ...(fetch === undefined ? {} : { fetch }),
    })
  }
}
