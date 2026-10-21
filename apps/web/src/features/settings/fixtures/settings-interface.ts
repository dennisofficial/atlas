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

export type Shortcut = { action: string; keys: string[] }
export type ShortcutSection = { title: string; shortcuts: Shortcut[] }

export const SHORTCUT_SECTIONS: ShortcutSection[] = [
  {
    title: 'General',
    shortcuts: [
      { action: 'Open command palette', keys: ['⌘', 'K'] },
      { action: 'Personal settings', keys: ['⌘', ','] },
      { action: 'Workspace settings', keys: ['⌥', '⌘', ','] },
      { action: 'Toggle sidebar', keys: ['⌘', 'B'] },
      { action: 'Show keymap', keys: ['?'] },
      { action: 'Search threads', keys: ['⌘', 'P'] },
    ],
  },
  {
    title: 'Threads',
    shortcuts: [
      { action: 'New thread', keys: ['⌘', 'N'] },
      { action: 'Next thread', keys: ['⌥', '↓'] },
      { action: 'Previous thread', keys: ['⌥', '↑'] },
      { action: 'Pin thread', keys: ['⌘', '⇧', 'P'] },
      { action: 'Archive thread', keys: ['⌘', '⇧', 'E'] },
      { action: 'Interrupt turn', keys: ['Esc'] },
    ],
  },
  {
    title: 'Composer',
    shortcuts: [
      { action: 'Send message', keys: ['⌘', '⏎'] },
      { action: 'New line', keys: ['⇧', '⏎'] },
      { action: 'Attach file', keys: ['⌘', 'U'] },
      { action: 'Switch model', keys: ['⌘', '/'] },
      { action: 'Cycle effort', keys: ['⇧', 'Tab'] },
      { action: 'Edit last message', keys: ['↑'] },
    ],
  },
  {
    title: 'Session panel',
    shortcuts: [
      { action: 'Toggle terminal', keys: ['⌘', 'J'] },
      { action: 'Show changes', keys: ['⌘', '1'] },
      { action: 'Show files', keys: ['⌘', '2'] },
      { action: 'Show preview', keys: ['⌘', '3'] },
      { action: 'Copy preview URL', keys: ['⌘', '⇧', 'C'] },
    ],
  },
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

export type ChannelState = { push: boolean; email: boolean; slack: boolean }

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
