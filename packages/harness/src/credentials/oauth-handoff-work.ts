import type { AccountId, ClockPort, StoredAccount } from '@dltech/atlas-core'

import type { CloudSession } from '../cloud/cloud-session'
import { credentialErrorOf } from './cloud-credential-errors'
import type { CredentialError } from './credential-error'
import type { OauthHandoff } from './oauth-handoff'

const RETRY_INTERVAL_MS = 5_000

export class OauthHandoffWork {
  private readonly running = new Map<AccountId, Promise<StoredAccount | undefined>>()
  private readonly startedAt = new Map<AccountId, number>()

  constructor(private readonly args: {
    handoff: OauthHandoff
    clock: ClockPort
    onFailure?: ((error: CredentialError) => void) | undefined
  }) {}

  enqueue(args: { accountId: AccountId; session: CloudSession }): void {
    if (this.running.has(args.accountId)) return
    const now = Date.parse(this.args.clock.now())
    const previous = this.startedAt.get(args.accountId)
    if (previous !== undefined && now - previous < RETRY_INTERVAL_MS) return
    this.startedAt.set(args.accountId, now)
    const work = this.args.handoff.transfer(args).catch((error: unknown) => {
      try { this.args.onFailure?.(credentialErrorOf(error)) } catch {}
      return undefined
    }).finally(() => { this.running.delete(args.accountId) })
    this.running.set(args.accountId, work)
  }
}
