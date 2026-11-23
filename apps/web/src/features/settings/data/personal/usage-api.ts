import {
  usageReportDtoSchema,
  type UsageReportDto,
  type UsageReportInput,
} from '@dltech/atlas-protocol'

import { api, cloudCall } from '@/lib/api-client'

export async function fetchUsageReport(input: UsageReportInput): Promise<UsageReportDto> {
  return usageReportDtoSchema.parse(await cloudCall(api.usage.report.query(input)))
}

export const usageQueryKey = (input: UsageReportInput): string =>
  'accountId' in input ? `usage-account-${input.accountId}` : `usage-provider-${input.provider}`
