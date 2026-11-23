import { UNMETERED, type AccountUsage } from './window'

export type UsageReport = {
  reading: AccountUsage | typeof UNMETERED
  fetchedAt: string | null
}
