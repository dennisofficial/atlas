import { createHash } from 'node:crypto'
import type { CodexModelsPorts } from '@dltech/atlas-harness/models'

const DEFAULT_MAX_USERS = 1000

export const sha256Identity = (credential: {
  accountId: string
  providerAccountId?: string | undefined
}): string =>
  createHash('sha256')
    .update(credential.providerAccountId ?? credential.accountId)
    .digest('hex')

export class CodexCacheRegistry {
  private readonly entries = new Map<string, string>()

  constructor(private readonly maxUsers = DEFAULT_MAX_USERS) {}

  cacheFor(userId: string): CodexModelsPorts['cache'] {
    return {
      read: () => {
        const text = this.entries.get(userId)
        if (text !== undefined) this.touch({ userId, text })
        return text
      },
      write: (text) => this.touch({ userId, text }),
    }
  }

  private touch(args: { userId: string; text: string }): void {
    this.entries.delete(args.userId)
    this.entries.set(args.userId, args.text)
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= this.maxUsers) break
      this.entries.delete(oldest)
    }
  }
}
