import { EDensity, ETheme } from '@dltech/atlas-wire/web'

export { EDensity, ETheme }

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

export type NotifyMomentId = 'finished' | 'errored' | 'approval'

export type NotifyMomentRow = { id: NotifyMomentId; title: string; description: string }

export const NOTIFY_MOMENTS: readonly NotifyMomentRow[] = [
  { id: 'finished', title: 'Finished', description: 'A turn ended and the agent is done.' },
  { id: 'errored', title: 'Failed', description: 'A turn stopped on a failure.' },
  {
    id: 'approval',
    title: 'Waiting for you',
    description: 'A tool call or a credential needs your answer.',
  },
]

export type NotifyEventToggles = Record<NotifyMomentId, boolean>

export type NotificationSettings = {
  events: NotifyEventToggles
  quietHours: boolean
  quietFrom: string
  quietTo: string
  timezone: string
}

export const QUIET_HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => {
  const value = `${String(hour).padStart(2, '0')}:00`
  return { value, label: value }
})
