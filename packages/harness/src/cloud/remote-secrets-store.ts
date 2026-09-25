import type { SecretsPort } from '@dltech/atlas-core'

import { CloudError, type CloudClient } from './cloud-client'

const asCloudError = (cause: unknown): CloudError =>
  cause instanceof CloudError
    ? cause
    : new CloudError({
        status: 0,
        message: cause instanceof Error ? cause.message : String(cause),
      })

const SECRETS_WRITE_BEHIND_NOTICE_KEY = 'cloud:secrets-write-behind'

export class RemoteSecretsStore implements SecretsPort {
  private readonly client: CloudClient
  private readonly onWriteFailure:
    | ((args: { name: string; failure: CloudError }) => void)
    | undefined
  private held = new Map<string, string>()
  private touched = new Map<string, number>()
  private failedWrites = new Set<string>()
  private version = 0
  private warming: Promise<void> | null = null
  private queue: Promise<CloudError | null> = Promise.resolve(null)
  private pending = 0
  private lastFailure: CloudError | null = null

  constructor(args: {
    client: CloudClient
    onWriteFailure?: ((args: { name: string; failure: CloudError }) => void) | undefined
  }) {
    this.client = args.client
    this.onWriteFailure = args.onWriteFailure
  }

  get failure(): CloudError | null {
    return this.lastFailure
  }

  async warm(): Promise<void> {
    this.warming ??= this.warmOnce().finally(() => {
      this.warming = null
    })
    return this.warming
  }

  private async warmOnce(): Promise<void> {
    const startedAt = this.version
    await this.queue

    const secrets = await this.client.listSecrets()
    const fresh = new Map(secrets.map((secret) => [secret.name, secret.value]))

    for (const [name, at] of this.touched) {
      const keepLocal = at > startedAt || this.failedWrites.has(name)
      if (!keepLocal) {
        this.touched.delete(name)
        continue
      }
      const held = this.held.get(name)
      if (held === undefined) fresh.delete(name)
      else fresh.set(name, held)
    }

    this.held = fresh
  }

  origin(): string {
    return `${this.client.baseUrl}/v1/secrets`
  }

  read(name: string): string | undefined {
    return this.held.get(name)
  }

  write(args: { name: string; value: string }): void {
    this.held.set(args.name, args.value)
    this.touched.set(args.name, (this.version += 1))
    this.enqueue(args.name, () => this.client.putSecret(args))
  }

  remove(name: string): void {
    this.held.delete(name)
    this.touched.set(name, (this.version += 1))
    this.enqueue(name, () => this.client.deleteSecret({ name }))
  }

  settled(): Promise<void> {
    return this.queue.then((failure) => {
      if (failure !== null) throw failure
    })
  }

  private enqueue(name: string, task: () => Promise<void>): void {
    if (this.pending === 0) this.queue = Promise.resolve(null)
    this.pending += 1
    this.queue = this.queue.then(async (prior) => {
      let failure: CloudError | null = null
      try {
        await task()
        this.failedWrites.delete(name)
      } catch (cause) {
        failure = asCloudError(cause)
        this.failedWrites.add(name)
        this.lastFailure = failure
        this.onWriteFailure?.({ name, failure })
      }
      this.pending -= 1
      const first = prior ?? failure
      if (this.pending === 0 && first === null) this.lastFailure = null
      return first
    })
  }
}
