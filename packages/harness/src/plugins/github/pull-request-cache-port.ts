
import { join } from 'node:path'

import {
  createPullRequestCache,
  PULL_REQUEST_CACHE_FILE_NAME,
  type PullRequestCache,
} from './pull-request-cache'
import {
  EPullRequestLookup,
  PullRequestPort,
  pullRequestBadgeKeyString,
  type PullRequestBadgeKey,
  type PullRequestReading,
  type RepositoryCheckout,
} from './pure'

export const PULL_REQUEST_PORT_CONCURRENCY = 4

export class CachedPullRequestPort extends PullRequestPort {
  readonly pushes: boolean

  private readonly cache: PullRequestCache
  private readonly inner: PullRequestPort
  private running = 0
  private readonly waiting: Array<() => void> = []

  constructor(
    args: {
      inner: PullRequestPort
      directory?: string | undefined
      file?: string | undefined
      now?: (() => number) | undefined
    },
  ) {
    super()
    const { inner } = args
    this.inner = inner
    this.pushes = inner.pushes
    if (args?.file === undefined && args?.directory === undefined) {
      throw new Error('CachedPullRequestPort needs the Atlas home it may cache under')
    }
    this.cache = createPullRequestCache({
      file: args.file ?? join(args.directory ?? '', PULL_REQUEST_CACHE_FILE_NAME),
      ...(args.now === undefined ? {} : { now: args.now }),
    })
  }

  async read(request: { checkout: RepositoryCheckout }): Promise<PullRequestReading> {
    const reading = await this.bounded(() => this.inner.read(request))
    this.cache.ingest({
      key: keyString({ kind: 'checkout', checkout: request.checkout }),
      reading,
    })
    if (reading.lookup === EPullRequestLookup.Found) {
      const { host, owner, repo } = request.checkout.remote
      this.cache.ingest({
        key: `${host}/${owner}/${repo}#${reading.pullRequest.number}`,
        reading,
      })
    }
    return reading
  }

  async readLinked(args: { repo: string; number: number }): Promise<PullRequestReading> {
    const reading = await this.bounded(() => this.inner.readLinked(args))
    this.cache.ingest({ key: `${args.repo}#${args.number}`, reading })
    return reading
  }

  override peekBadge(args: PullRequestBadgeKey): PullRequestReading | null {
    return this.cache.peek({ key: keyString(args) })
  }

  override freshenBadge(args: PullRequestBadgeKey): void {
    this.cache.freshen({
      key: keyString(args),
      ask: () =>
        args.kind === 'checkout'
          ? this.read({ checkout: args.checkout })
          : this.readLinked({ repo: args.repo, number: args.number }),
    })
  }

  override onBadges(listener: () => void): () => void {
    return this.cache.subscribe(listener)
  }

  ingest(args: { key: string; reading: PullRequestReading }): void {
    this.cache.ingest(args)
  }

  dispose(): void {
    this.cache.dispose()
  }

  private async bounded<T>(ask: () => Promise<T>): Promise<T> {
    await this.turn()
    try {
      return await ask()
    } finally {
      this.release()
    }
  }

  private async turn(): Promise<void> {
    if (this.running < PULL_REQUEST_PORT_CONCURRENCY) {
      this.running += 1
      return
    }

    await new Promise<void>((resolve) => this.waiting.push(resolve))
  }

  private release(): void {
    if (this.waiting.length === 0) {
      this.running -= 1
      return
    }
    this.waiting.shift()?.()
  }
}

const keyString = (args: PullRequestBadgeKey): string =>
  pullRequestBadgeKeyString(args)
