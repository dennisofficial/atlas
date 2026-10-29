import { ETerminalConnection } from '@dltech/atlas-ui/ai/terminal-states'

import type { Control, Values } from '@/proto/use-prototype'

import { type AppThread, SESSION_THREAD_ID } from '../shell/fixtures/app'
import { enumValueOf } from './enum-value'
import { MAX_QUEUED } from './queue-fixtures'
import type { SessionViewProps } from './session-view'
import { ERightTab, ESessionState } from './session-types'

export const THREAD_CONTROLS = {
  state: {
    type: 'select',
    label: 'Session state',
    options: Object.values(ESessionState),
    default: ESessionState.Running,
  },
  tab: {
    type: 'select',
    label: 'Right tab',
    options: Object.values(ERightTab),
    default: ERightTab.Details,
  },
  terminal: {
    type: 'select',
    label: 'Terminal',
    options: Object.values(ETerminalConnection),
    default: ETerminalConnection.Connected,
  },
  detail: { type: 'boolean', label: 'Agent detail', default: false },
  queued: {
    type: 'range',
    label: 'Queued',
    min: 0,
    max: MAX_QUEUED,
    step: 1,
    default: 2,
  },
} satisfies Record<string, Control>

export type ThreadTweaks = Values<typeof THREAD_CONTROLS>

export function headerFor(thread: AppThread | undefined): SessionViewProps['header'] {
  if (!thread || thread.id === SESSION_THREAD_ID) return {}
  return { title: thread.title }
}

export function tweaksOf(values: ThreadTweaks) {
  return {
    state: enumValueOf({
      options: Object.values(ESessionState),
      value: values.state,
      fallback: ESessionState.Running,
    }),
    tab: enumValueOf({
      options: Object.values(ERightTab),
      value: values.tab,
      fallback: ERightTab.Details,
    }),
    terminal: enumValueOf({
      options: Object.values(ETerminalConnection),
      value: values.terminal,
      fallback: ETerminalConnection.Connected,
    }),
  }
}
