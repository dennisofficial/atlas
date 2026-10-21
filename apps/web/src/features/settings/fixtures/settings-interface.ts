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

export enum ENotifyChannel {
  InApp = 'inApp',
  Push = 'push',
  Email = 'email',
}

export type NotifyEvent = { id: string; title: string; description: string }

export const NOTIFY_EVENTS: NotifyEvent[] = [
  { id: 'finished', title: 'Thread finished', description: 'The agent completed its turn.' },
  {
    id: 'approval',
    title: 'Waiting for approval',
    description: 'A tool call needs your go-ahead.',
  },
  { id: 'errored', title: 'Thread errored', description: 'The turn stopped on a failure.' },
  {
    id: 'checks',
    title: 'PR checks failed',
    description: "CI went red on a thread's pull request.",
  },
  {
    id: 'mention',
    title: 'Mentioned by a teammate',
    description: 'Someone @-mentioned you in a thread.',
  },
  {
    id: 'paused',
    title: 'Sandbox auto-paused',
    description: 'A sandbox idled out and was paused.',
  },
]

export type NotifyMatrix = Record<string, Record<ENotifyChannel, boolean>>

export type ChannelState = { push: boolean; email: boolean }

export type NotificationSettings = {
  channels: ChannelState
  matrix: NotifyMatrix
  quietHours: boolean
  quietFrom: string
  quietTo: string
}

export const QUIET_HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => {
  const value = `${String(hour).padStart(2, '0')}:00`
  return { value, label: value }
})
