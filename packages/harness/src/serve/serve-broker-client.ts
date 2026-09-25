import {
  accountSchema,
  accountIdSchema,
  EAuthKind,
  EAuthProvider,
  type Account,
  type AccountId,
} from '@dltech/atlas-core'
import { z } from 'zod'

import { cloudRequest } from '../cloud/cloud-transport'

const accountsResponseSchema = z.strictObject({
  accounts: z.array(accountSchema),
  active: z.array(z.strictObject({ provider: z.enum(EAuthProvider), accountId: accountIdSchema })),
})

export type ServeBrokerAccounts = z.infer<typeof accountsResponseSchema>

const accessTokenResponseSchema = z.strictObject({
  accountId: accountIdSchema,
  kind: z.enum(EAuthKind),
  accessToken: z.string().min(1),
  expiresAt: z.string().nullable(),
  providerAccountId: z.string().optional(),
})

export type ServeBrokeredToken = z.infer<typeof accessTokenResponseSchema>

const secretsResponseSchema = z.strictObject({
  secrets: z.array(z.strictObject({ name: z.string().min(1), value: z.string(), updatedAt: z.string() })),
})

/**
 * The sandbox-side face of the control plane's thread-scoped broker. The serve process holds only
 * its sandbox session token, which the API refuses on the user-facing account and secret routes —
 * everything the running agent needs is resolved per thread under `/v1/sandboxes/:threadId/broker`.
 */
export class ServeBrokerClient {
  private readonly url: string
  private readonly token: string
  private readonly threadId: string
  private readonly clientVersion: string
  private readonly fetchFn: typeof fetch
  private readonly sleep: ((ms: number) => Promise<void>) | undefined

  constructor(args: {
    url: string
    token: string
    threadId: string
    clientVersion?: string
    fetchFn?: typeof fetch
    sleep?: ((ms: number) => Promise<void>) | undefined
  }) {
    this.url = args.url.replace(/\/+$/, '')
    this.token = args.token
    this.threadId = args.threadId
    this.clientVersion = args.clientVersion ?? 'dev'
    this.fetchFn = args.fetchFn ?? fetch
    this.sleep = args.sleep
  }

  get baseUrl(): string {
    return this.url
  }

  async accounts(): Promise<{ accounts: Account[]; active: { provider: EAuthProvider; accountId: AccountId }[] }> {
    const body = await this.request({ method: 'GET', path: 'accounts' })
    return accountsResponseSchema.parse(body)
  }

  async accessToken(args: {
    provider: EAuthProvider
    accountId?: AccountId | undefined
    rejectedAccessToken?: string | undefined
  }): Promise<ServeBrokeredToken> {
    const body = await this.request({
      method: 'POST',
      path: 'access-token',
      body: {
        provider: args.provider,
        ...(args.accountId === undefined ? {} : { accountId: args.accountId }),
        ...(args.rejectedAccessToken === undefined
          ? {}
          : { rejectedAccessToken: args.rejectedAccessToken }),
      },
    })
    return accessTokenResponseSchema.parse(body)
  }

  async secrets(args: { names: string[] }): Promise<{ name: string; value: string }[]> {
    if (args.names.length === 0) return []
    const body = await this.request({ method: 'POST', path: 'secrets', body: { names: args.names } })
    return secretsResponseSchema.parse(body).secrets
  }

  private request(args: { method: string; path: string; body?: unknown }): Promise<unknown> {
    return cloudRequest({
      url: this.url,
      token: this.token,
      clientVersion: this.clientVersion,
      fetchFn: this.fetchFn,
      method: args.method,
      path: `/v1/sandboxes/${this.threadId}/broker/${args.path}`,
      ...(args.body === undefined ? {} : { body: args.body }),
      retry: args.method === 'GET',
      ...(this.sleep === undefined ? {} : { sleep: this.sleep }),
    })
  }
}
