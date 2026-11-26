import type { PodAnalyticsValue } from '@dltech/atlas-plugin-sdk'

export const QUALITY_REVIEW_UNAVAILABLE = 'quality review unavailable'

export enum EQualityUnavailableReason {
  ClassifierOff = 'classifier_off',
  SettingOff = 'setting_off',
  BashWrite = 'bash_write',
}

const reported = new Set<string>()

export const forgetUnavailableReports = (): void => {
  reported.clear()
}

export const reportUnavailableOnce = (args: {
  sessionId: string
  reason: EQualityUnavailableReason
}): boolean => {
  const key = `${args.sessionId}\u0000${args.reason}`
  if (reported.has(key)) return false
  reported.add(key)
  return true
}

export const unavailableProperties = ({
  reason,
}: {
  reason: EQualityUnavailableReason
}): Readonly<Record<string, PodAnalyticsValue>> => ({ reason })
