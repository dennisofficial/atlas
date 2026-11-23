import type { AccountId, AccountUsage } from '@dltech/atlas-core'

export interface UsageClient {
  read(args: { accountId?: AccountId | undefined }): Promise<AccountUsage | null>
}
