import type { AccountId } from '../credentials/account'
import type { UsageReading } from '../usage/window'

export type AccountUsageRequest = { accountId?: AccountId | undefined }

export abstract class AccountUsagePort {
  abstract read(request?: AccountUsageRequest): Promise<UsageReading | null>
}
