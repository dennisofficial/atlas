import {
  choiceValueOf,
  DEFAULT_WARN_PERCENT,
  ESettingId,
  EUsageWindow,
  formatFavourites,
  parseFavourites,
  rangeValueOf,
  textValueOf,
  toggleValueOf,
  type SettingsResolution,
} from '@dltech/atlas-core'

import { SHIPPED_THINKING, thinkingVisibilityOf, type EThinkingVisibility } from '../store'
import {
  EFooterMeters,
  footerMetersOf,
  SHIPPED_FOOTER_METERS,
} from '../ui/usage-meters'
import { SIDEBAR_FOLD_BELOW, SIDEBAR_WIDTH } from '../ui/theme'

const AUTO_COMPACT_AT_PERCENT = 90

const NOTICE_SECONDS = 2

export type SettingsPreferences = {
  sidebarWidth: number
  sidebarFoldBelow: number
  autoCompactAtPercent: number
  autoRestart: boolean
  noticeSeconds: number
  paceReveal: boolean
  thinking: EThinkingVisibility
  tldrStatus: boolean
  footerMeters: EFooterMeters
  usageWarn: Record<EUsageWindow, number>
  modelFavourites: readonly string[]
}

export function preferencesOf(resolution: SettingsResolution): SettingsPreferences {
  return {
    sidebarWidth: rangeValueOf({ resolution, id: ESettingId.SidebarWidth, fallback: SIDEBAR_WIDTH }),
    sidebarFoldBelow: rangeValueOf({
      resolution,
      id: ESettingId.SidebarFoldBelow,
      fallback: SIDEBAR_FOLD_BELOW,
    }),
    autoCompactAtPercent: rangeValueOf({
      resolution,
      id: ESettingId.AutoCompact,
      fallback: AUTO_COMPACT_AT_PERCENT,
    }),
    autoRestart: toggleValueOf({ resolution, id: ESettingId.AutoRestart }),
    noticeSeconds: rangeValueOf({ resolution, id: ESettingId.NoticeSeconds, fallback: NOTICE_SECONDS }),
    paceReveal: toggleValueOf({ resolution, id: ESettingId.SmoothStreaming }),
    footerMeters: footerMetersOf(
      choiceValueOf({ resolution, id: ESettingId.FooterMeters, fallback: SHIPPED_FOOTER_METERS }),
    ),
    usageWarn: {
      [EUsageWindow.FiveHour]: rangeValueOf({
        resolution,
        id: ESettingId.WarnFiveHour,
        fallback: DEFAULT_WARN_PERCENT[EUsageWindow.FiveHour],
      }),
      [EUsageWindow.SevenDay]: rangeValueOf({
        resolution,
        id: ESettingId.WarnWeekly,
        fallback: DEFAULT_WARN_PERCENT[EUsageWindow.SevenDay],
      }),
    },
    thinking: thinkingVisibilityOf(
      choiceValueOf({ resolution, id: ESettingId.ThinkingBlocks, fallback: SHIPPED_THINKING }),
    ),
    tldrStatus: toggleValueOf({ resolution, id: ESettingId.TldrStatus }),
    modelFavourites: parseFavourites(textValueOf({ resolution, id: ESettingId.ModelFavourites })),
  }
}
