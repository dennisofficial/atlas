import { EDensity, ETheme } from '@dltech/atlas-wire/web'

export { EDensity, ETheme }
export {
  NOTIFY_MOMENTS,
  QUIET_HOUR_OPTIONS,
  type NotificationSettings,
  type NotifyEventToggles,
  type NotifyMomentId,
  type NotifyMomentRow,
} from '@dltech/atlas-client/settings'

export type AppearanceSettings = {
  theme: ETheme
  density: EDensity
  codeFontSize: 12 | 13 | 14
  showDiffStat: boolean
  reduceMotion: boolean
}

export const CODE_FONT_SIZES = [
  { value: '12', label: '12 px' },
  { value: '13', label: '13 px' },
  { value: '14', label: '14 px' },
]
