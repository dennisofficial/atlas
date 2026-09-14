import {
  accountIdSchema,
  accountSchema,
  storedAccountSchema,
  type Account,
  type AccountDraft,
  type AccountId,
  type AccountSecret,
  type EAccountStatus,
  type EAuthProvider,
  type StoredAccount,
} from '@dltech/atlas-core'
import { z } from 'zod'

export class CloudError extends Error {
  readonly status: number

  constructor(args: { status: number; message: string }) {
    super(args.message)
    this.name = 'CloudError'
    this.status = args.status
  }
}

const activeAccountResponseSchema = z.object({ accountId: accountIdSchema.nullable() })

const detailFrom = (body: unknown): string | undefined => {
  if (typeof body !== 'object' || body === null) return undefined

  const message = Reflect.get(body, 'message')
  if (typeof message === 'string' && message.length > 0) return message
  if (Array.isArray(message) && message.every((part) => typeof part === 'string'))
    return message.join('; ')

  const error = Reflect.get(body, 'error')
  if (typeof error === 'string' && error.length > 0) return error

  return undefined
}

export class CloudClient {
  private readonly url: string
  private readonly token: string
  private readonly fetchFn: typeof fetch

  constructor(args: { url: string; token: string; fetchFn?: typeof fetch }) {
    this.url = args.url.replace(/\/+$/, '')
    this.token = args.token
    this.fetchFn = args.fetchFn ?? fetch
  }

  async health(): Promise<boolean> {
    try {
      const response = await this.fetchFn(`${this.url}/v1/health`)
      return response.ok
    } catch {
      return false
    }
  }

  async listAccounts(): Promise<readonly Account[]> {
    const body = await this.request({ method: 'GET', path: '/v1/accounts' })
    return z.array(accountSchema).parse(body)
  }

  async readAccount(args: { accountId: AccountId }): Promise<StoredAccount | undefined> {
    const body = await this.request({
      method: 'GET',
      path: `/v1/accounts/${args.accountId}`,
      allowMissing: true,
    })
    if (body === undefined) return undefined

    return storedAccountSchema.parse(body)
  }

  async addAccount(args: { draft: AccountDraft }): Promise<Account> {
    const { draft } = args
    const body = await this.request({
      method: 'POST',
      path: '/v1/accounts',
      body: {
        provider: draft.provider,
        label: draft.label,
        secret: draft.secret,
        origin: draft.origin,
        ...(draft.email === undefined ? {} : { email: draft.email }),
        ...(draft.subscription === undefined ? {} : { subscription: draft.subscription }),
        ...(draft.importedFrom === undefined ? {} : { importedFrom: draft.importedFrom }),
      },
    })

    return accountSchema.parse(body)
  }

  async replaceAccountSecret(args: {
    accountId: AccountId
    secret: AccountSecret
  }): Promise<void> {
    await this.request({
      method: 'PUT',
      path: `/v1/accounts/${args.accountId}/secret`,
      body: { secret: args.secret },
    })
  }

  async setAccountStatus(args: {
    accountId: AccountId
    status: EAccountStatus
  }): Promise<void> {
    await this.request({
      method: 'PATCH',
      path: `/v1/accounts/${args.accountId}/status`,
      body: { status: args.status },
    })
  }

  async removeAccount(args: { accountId: AccountId }): Promise<void> {
    await this.request({ method: 'DELETE', path: `/v1/accounts/${args.accountId}` })
  }

  async setActiveAccount(args: {
    provider: EAuthProvider
    accountId: AccountId
  }): Promise<void> {
    await this.request({
      method: 'PUT',
      path: '/v1/accounts/active',
      body: { provider: args.provider, accountId: args.accountId },
    })
  }

  async activeAccount(args: { provider: EAuthProvider }): Promise<AccountId | undefined> {
    const body = await this.request({
      method: 'GET',
      path: `/v1/accounts/active/${args.provider}`,
    })
    const parsed = activeAccountResponseSchema.parse(body)

    return parsed.accountId ?? undefined
  }

  private async request(args: {
    method: string
    path: string
    body?: unknown
    allowMissing?: boolean
  }): Promise<unknown> {
    let response: Response
    try {
      response = await this.fetchFn(`${this.url}${args.path}`, {
        method: args.method,
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(args.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(args.body === undefined ? {} : { body: JSON.stringify(args.body) }),
      })
    } catch (cause) {
      throw new CloudError({
        status: 0,
        message: `The Atlas Cloud API at ${this.url} could not be reached: ${cause instanceof Error ? cause.message : String(cause)}.`,
      })
    }

    const text = await response.text()
    const parsed: unknown = text.length === 0 ? undefined : safeJson(text)

    if (response.status === 404 && args.allowMissing === true) return undefined

    if (!response.ok) {
      const detail = detailFrom(parsed)
      throw new CloudError({
        status: response.status,
        message: `The Atlas Cloud API answered ${args.method} ${args.path} with ${response.status}${detail === undefined ? '' : `: ${detail}`}.`,
      })
    }

    return parsed
  }
}

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
