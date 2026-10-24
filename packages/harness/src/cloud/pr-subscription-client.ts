import type { ApiClient } from '@dltech/atlas-api-router'
import { githubPrStateSchema, type GithubPrState } from '@dltech/atlas-wire'
import { z } from 'zod'

import { cloudCall, createHarnessApiClient } from './api-trpc-client'
import {
  backoffDelayMs,
  defaultSleep,
  isRetryableStatus,
  noteGiveUp,
  noteRetry,
} from './cloud-retry'
import type { CloudSession } from './cloud-session'
import {
  CloudError,
  DEFAULT_RETRY_BASE_DELAY_MS,
  DEFAULT_RETRY_CEILING_DELAY_MS,
  DEFAULT_RETRY_MAX_ATTEMPTS,
  type TransportRetryLog,
} from './cloud-transport'

const subscribeResponseSchema = z.object({
  id: z.string().min(1),
  prNumber: z.number().int().positive().nullable(),
  branch: z.string().optional(),
  pollBacked: z.boolean(),
  expiresAt: z.string(),
  state: githubPrStateSchema.nullable(),
  recommendAppInstall: z.object({ installUrl: z.string(), repoFullName: z.string() }).optional(),
})

export type SubscriptionPrState = GithubPrState

export type AppInstallRecommendation = { installUrl: string; repoFullName: string }

export type SubscriptionOutcome = {
  id: string
  pollBacked: boolean
  state: SubscriptionPrState | null
  branch: string | null
  recommendAppInstall?: AppInstallRecommendation
}

export type SubscriptionHandle = { id: string; repoFullName: string }

export type StreamEndpoint = { baseUrl: string; token: string; clientVersion: string }

const lateBoundFetch: typeof fetch = Object.assign(
  (input: Parameters<typeof fetch>[0], init?: RequestInit) => globalThis.fetch(input, init),
  { preconnect: fetch.preconnect },
)

const isRetryableFailure = (failure: unknown): boolean =>
  failure instanceof CloudError && (failure.status === 0 || isRetryableStatus(failure.status))

/**
 * The request half of the realtime pull request channel: subscribe / heartbeat / unsubscribe
 * over `githubSubscriptions`. The stream itself is `runSseStream`'s; this client only owns the
 * calls that create and renew what the stream delivers for. The shared adapter retries only GETs,
 * so subscribe and heartbeat carry their own retry here.
 */
export class PrSubscriptionClient {
  private readonly api: ApiClient
  private readonly session: CloudSession
  private readonly clientVersion: string
  private readonly log: TransportRetryLog | undefined

  constructor(args: {
    session: CloudSession
    clientVersion: string
    log?: TransportRetryLog | undefined
  }) {
    this.session = args.session
    this.clientVersion = args.clientVersion
    this.log = args.log
    this.api = createHarnessApiClient({
      url: args.session.url,
      token: args.session.token,
      clientVersion: args.clientVersion,
      fetchFn: lateBoundFetch,
      log: args.log,
    })
  }

  streamEndpoint(): StreamEndpoint {
    return {
      baseUrl: this.session.url,
      token: this.session.token,
      clientVersion: this.clientVersion,
    }
  }

  async subscribe(args: {
    repoFullName: string
    branch?: string
    number?: number
  }): Promise<SubscriptionOutcome> {
    const input =
      args.number === undefined
        ? {
            repoFullName: args.repoFullName,
            ...(args.branch === undefined ? {} : { branch: args.branch }),
          }
        : { repoFullName: args.repoFullName, prNumber: args.number }
    const body = await this.retried({
      procedure: 'githubSubscriptions.subscribe',
      call: () => this.api.githubSubscriptions.subscribe.mutate(input),
    })
    const parsed = subscribeResponseSchema.parse(body)
    return {
      id: parsed.id,
      pollBacked: parsed.pollBacked,
      state: parsed.state,
      branch: parsed.branch ?? null,
      ...(parsed.recommendAppInstall === undefined
        ? {}
        : {
            recommendAppInstall: {
              installUrl: parsed.recommendAppInstall.installUrl,
              repoFullName: parsed.recommendAppInstall.repoFullName,
            },
          }),
    }
  }

  async heartbeat(args: { id: string }): Promise<void> {
    await this.retried({
      procedure: 'githubSubscriptions.heartbeat',
      call: () => this.api.githubSubscriptions.heartbeat.mutate({ id: args.id }),
    })
  }

  async unsubscribe(args: { id: string }): Promise<void> {
    await cloudCall(this.api.githubSubscriptions.unsubscribe.mutate({ id: args.id }), {
      allowMissing: true,
    })
  }

  private async retried<T>(args: { procedure: string; call: () => Promise<T> }): Promise<T> {
    const path = `/v1/trpc/${args.procedure}`
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await cloudCall(args.call())
      } catch (failure) {
        const cause = failure instanceof CloudError ? `status ${failure.status}` : String(failure)
        if (!isRetryableFailure(failure) || attempt >= DEFAULT_RETRY_MAX_ATTEMPTS - 1) {
          if (isRetryableFailure(failure)) {
            noteGiveUp({ log: this.log, method: 'POST', path, cause, attempt })
          }
          throw failure
        }
        const delayMs = backoffDelayMs({
          attempt,
          baseDelayMs: DEFAULT_RETRY_BASE_DELAY_MS,
          ceilingDelayMs: DEFAULT_RETRY_CEILING_DELAY_MS,
          randomFn: Math.random,
        })
        noteRetry({ log: this.log, method: 'POST', path, cause, attempt, delayMs })
        await defaultSleep(delayMs)
      }
    }
  }
}
