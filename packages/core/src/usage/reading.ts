import { EAuthProvider } from '../credentials/account'
import { parseRef } from '../models/ref'
import { formatUtilization } from './format'
import { DEFAULT_WARN_PERCENT, EMeterBand, meterBand } from './meter'
import { type AccountUsage, EUsageWindow, shownWindowsOf } from './window'

const PROVIDER_OF_ID: Record<string, EAuthProvider> = {
  anthropic: EAuthProvider.Anthropic,
  openai: EAuthProvider.OpenAI,
  openrouter: EAuthProvider.OpenRouter,
  inference: EAuthProvider.Inference,
  gateway: EAuthProvider.Gateway,
  typesafe: EAuthProvider.Typesafe,
}

export const WINDOW_SHORT: Record<EUsageWindow, string> = {
  [EUsageWindow.FiveHour]: '5h',
  [EUsageWindow.SevenDay]: '7d',
}

export const WINDOW_LONG: Record<EUsageWindow, string> = {
  [EUsageWindow.FiveHour]: '5-hour',
  [EUsageWindow.SevenDay]: '7-day',
}

export const usageProviderOf = (
  choice: { ref: string } | null | undefined,
): EAuthProvider | null => {
  const providerId =
    choice === null || choice === undefined ? undefined : parseRef(choice.ref)?.providerId
  if (providerId === undefined) return null
  return PROVIDER_OF_ID[providerId] ?? null
}

export type PlanUsageReading = {
  kind: EUsageWindow
  short: string
  utilization: number | null
  band: EMeterBand
}

export const planUsageReadingsOf = (usage: AccountUsage): readonly PlanUsageReading[] =>
  shownWindowsOf(usage).map((kind) => {
    const utilization = usage[kind]?.utilization ?? null
    return {
      kind,
      short: WINDOW_SHORT[kind],
      utilization,
      band: meterBand({ utilization, warnAt: DEFAULT_WARN_PERCENT[kind] }),
    }
  })

export const planUsageLabelOf = (usage: AccountUsage): string =>
  `Plan usage: ${shownWindowsOf(usage)
    .map((kind) => `${WINDOW_LONG[kind]} ${formatUtilization(usage[kind]?.utilization ?? null)}`)
    .join(', ')}`
