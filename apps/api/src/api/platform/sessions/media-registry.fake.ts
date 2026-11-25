import type { MediaRef } from '@dltech/atlas-core'
import { MediaRegistry } from './media-registry'

export class FakeMediaRegistry extends MediaRegistry {
  readonly rows = new Map<string, MediaRef>()

  private key(args: { userId: string; hash: string }): string {
    return `${args.userId}/${args.hash}`
  }

  async find(args: { userId: string; hash: string }): Promise<MediaRef | undefined> {
    return this.rows.get(this.key(args))
  }

  async findMany(args: { userId: string; hashes: readonly string[] }): Promise<MediaRef[]> {
    return args.hashes.flatMap(
      (hash) => this.rows.get(this.key({ userId: args.userId, hash })) ?? [],
    )
  }

  async insertIfAbsent(args: { userId: string; media: MediaRef }): Promise<void> {
    const key = this.key({ userId: args.userId, hash: args.media.hash })
    if (!this.rows.has(key)) this.rows.set(key, args.media)
  }
}
