import type { KeyEvent } from '@opentui/core'

import type { AppNextProps } from './app-next-props'

import type { FollowedSessionList } from '@dltech/atlas-client/stream'
import { refKey } from '@dltech/atlas-core'
import type { SessionModelChoice } from '@dltech/atlas-protocol'

import { ENoticeTone, notify } from '../ui/notice-store'
import type { SwitcherChoice } from '../ui/switcher-model'
import { EScreen, screenOnNew, type ScreenState } from './app-screen'
import { EOpenMode, type LaunchFlags } from './launch-flags'
import { applyModelSet } from './model-set'
import type { SessionApi } from './session-api'

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

export const modelPickOf = (args: {
  screen: ScreenState
  picked: SwitcherChoice
  api: SessionApi | null
  onProblem: (reason: string) => void
}): ScreenState | null => {
  if (args.screen.screen === EScreen.Transcript) {
    if (args.api === null) return null
    void applyModelSet({
      api: args.api,
      sessionId: args.screen.sessionId,
      choice: args.picked,
    }).catch((failure: unknown) => {
      args.onProblem(`could not switch the model — ${messageOf(failure)}`)
    })
    return null
  }

  const next = choiceToSessionChoice(args.picked)
  return next === null ? null : screenOnNew({ model: next })
}

export const accountFlowArgsOf = (props: AppNextProps) => ({
  accountPath: props.accountPath,
  apiUrl: props.apiUrl,
  webOrigin: props.webOrigin,
  env: props.env,
  platform: props.platform,
  initialAccount: props.initialAccount,
  openUrl: props.openUrl,
  fetchFn: props.fetchFn,
  exchangeLogin: props.exchangeLogin,
  startLoopbackWait: props.startLoopbackWait,
})
