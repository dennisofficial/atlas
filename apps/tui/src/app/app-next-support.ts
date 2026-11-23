import type { KeyEvent } from '@opentui/core'

import type { FollowedSessionList } from '@dltech/atlas-client/stream'
import { refKey } from '@dltech/atlas-core'
import type { SessionModelChoice } from '@dltech/atlas-protocol'

import { ENoticeTone, notify } from '../ui/notice-store'
import type { SwitcherChoice } from '../ui/switcher-model'
import { EOpenMode, type LaunchFlags } from './launch-flags'

export const EMPTY_SESSION_LIST: FollowedSessionList = {
  getSnapshot: () => [],
  subscribe: () => () => undefined,
  close: () => undefined,
}

export const DEFAULT_LAUNCH: LaunchFlags = { open: { mode: EOpenMode.New }, model: null }

export const SWITCHER_WIDTH = 64

export const isEnter = (key: KeyEvent): boolean => key.name === 'return' || key.name === 'enter'

export const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export const problemOf = (reason: string): void => {
  notify({ text: reason, tone: ENoticeTone.Warn })
}

export const modelOfRef = (ref: string): SessionModelChoice => ({
  ref,
  effort: 'medium',
  fast: false,
})

export const choiceToSessionChoice = (choice: SwitcherChoice): SessionModelChoice | null =>
  choice.ref === null ? null : { ref: refKey(choice.ref), effort: choice.effort, fast: choice.fast }
