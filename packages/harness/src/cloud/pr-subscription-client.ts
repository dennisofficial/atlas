import { z } from 'zod'

import { CloudTransport } from './cloud-transport'
import type { CloudSession } from './cloud-session'

const stateSchema = z.strictObject({
  repoFullName: z.string(),
  prNumber: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  state: z.string(),
  headBranch: z.string(),
  headSha: z.string(),
  checksRunning: z.number().int(),
  checksPassed: z.number().int(),
  checksFailed: z.number().int(),
  mergeable: z.boolean().nullable(),
  updatedAt: z.string(),
})

// The subscribe DTO carries repoFullName/prNumber alongside these; parse what we use and let
// the rest pass, so a server field we do not read never breaks the subscribe.
const subscribeResponseSchema = z.object({
  id: z.string().min(1),
  pollBacked: z.boolean(),
  expiresAt: z.string(),
  state: stateSchema.nullable(),
})

export type SubscriptionPrState = z.infer<typeof stateSchema>

export type SubscriptionOutcome = {
  id: string
  pollBacked: boolean
  state: SubscriptionPrState | null
}

export type SubscriptionHandle = { id: string; repoFullName: string }

/**
 * The REST half of the realtime pull request channel: subscribe / heartbeat / unsubscribe
 * against `/v1/github/subscriptions`. The stream itself is `runSseStream`'s; this client only
 * owns the calls that create and renew what the stream delivers for.
 */
export class PrSubscriptionClient {
  private readonly transport: CloudTransport
  private readonly session: CloudSession
  private readonly clientVersion: string

  constructor(args: { session: CloudSession; clientVersion: string }) {
    this.session = args.session
    this.clientVersion = args.clientVersion
    this.transport = new CloudTransport({
      url: args.session.url,
      token: args.session.token,
      clientVersion: args.clientVersion,
    })
  }

  token(): string {
    return this.session.token
  }

  clientVersionHeader(): string {
    return this.clientVersion
  }

  streamUrl(): string {
    return `${this.session.url.replace(/\/+$/, '')}/v1/github/prs/stream`
  }

  async subscribe(args: {
    repoFullName: string
    branch?: string
    number?: number
  }): Promise<SubscriptionOutcome> {
    const body = await this.transport.request({
      method: 'POST',
      path: '/v1/github/subscriptions',
      body: {
        repoFullName: args.repoFullName,
        ...(args.branch === undefined ? {} : { branch: args.branch }),
        ...(args.number === undefined ? {} : { prNumber: args.number }),
      },
    })
    const parsed = subscribeResponseSchema.parse(body)
    return { id: parsed.id, pollBacked: parsed.pollBacked, state: parsed.state }
  }

  async heartbeat(args: { id: string }): Promise<void> {
    await this.transport.request({
      method: 'POST',
      path: `/v1/github/subscriptions/${encodeURIComponent(args.id)}/heartbeat`,
    })
  }

  async unsubscribe(args: { id: string }): Promise<void> {
    await this.transport.request({
      method: 'DELETE',
      path: `/v1/github/subscriptions/${encodeURIComponent(args.id)}`,
      allowMissing: true,
    })
  }
}
