import type { SecretsPort } from '@dltech/atlas-core'

import { CloudError, type CloudClient } from './cloud-client'

const asCloudError = (cause: unknown): CloudError =>
  cause instanceof CloudError
    ? cause
    : new CloudError({
        status: 0,
        message: cause instanceof Error ? cause.message : String(cause),
      })

export class RemoteSecretsStore implements SecretsPort {
  private readonly client: CloudClient
  private held = new Map<string, string>()
  private queue: Promise<CloudError | null> = Promise.resolve(null)
  private pending = 0
  private lastFailure: CloudError | null = null

  constructor(args: { client: CloudClient }) {
    this.client = args.client
  }

  get failure(): CloudError | null {
    return this.lastFailure
  }

  async warm(): Promise<void> {
    const secrets = await this.client.listSecrets()
    this.held = new Map(secrets.map((secret) => [secret.name, secret.value]))
  }

  origin(): string {
    return `${this.client.baseUrl}/v1/secrets`
  }

  read(name: string): string | undefined {
    return this.held.get(name)
  }

  write(args: { name: string; value: string }): void {
    this.held.set(args.name, args.value)
    this.enqueue(() => this.client.putSecret(args))
  }

  remove(name: string): void {
    this.held.delete(name)
    this.enqueue(() => this.client.deleteSecret({ name }))
  }

  settled(): Promise<void> {
    return this.queue.then((failure) => {
      if (failure !== null) throw failure
    })
  }

  private enqueue(task: () => Promise<void>): void {
    if (this.pending === 0) this.queue = Promise.resolve(null)
    this.pending += 1
    this.queue = this.queue.then(async (prior) => {
      let failure: CloudError | null = null
      try {
        await task()
      } catch (cause) {
        failure = asCloudError(cause)
        this.lastFailure = failure
      }
      this.pending -= 1
      const first = prior ?? failure
      if (this.pending === 0 && first === null) this.lastFailure = null
      return first
    })
  }
}
