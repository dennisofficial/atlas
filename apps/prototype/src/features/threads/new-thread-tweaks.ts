import type { Control, Values } from '@/proto/use-prototype'

import { PROJECTS } from '../shell/fixtures/app'
import { enumValueOf } from './enum-value'
import { DEFAULT_PROJECT_ID } from './new-thread-data'
import { EFirstMessage, ENewThreadOutcome, EPodProgress } from './new-thread-types'

export const NO_PROJECT_OPTION = 'none'

export const NEW_THREAD_CONTROLS = {
  pod: {
    type: 'select',
    label: 'Pod',
    options: Object.values(EPodProgress),
    default: EPodProgress.None,
  },
  message: {
    type: 'select',
    label: 'First message',
    options: Object.values(EFirstMessage),
    default: EFirstMessage.None,
  },
  project: {
    type: 'select',
    label: 'Project',
    options: [NO_PROJECT_OPTION, ...PROJECTS.map((project) => project.id)],
    default: DEFAULT_PROJECT_ID,
  },
  outcome: {
    type: 'select',
    label: 'Outcome',
    options: Object.values(ENewThreadOutcome),
    default: ENewThreadOutcome.Success,
  },
  autoRun: { type: 'boolean', label: 'Auto-run', default: false },
} satisfies Record<string, Control>

export function newThreadPropsOf(values: Values<typeof NEW_THREAD_CONTROLS>) {
  return {
    initialPod: enumValueOf({
      options: Object.values(EPodProgress),
      value: values.pod,
      fallback: EPodProgress.None,
    }),
    initialMessage: enumValueOf({
      options: Object.values(EFirstMessage),
      value: values.message,
      fallback: EFirstMessage.None,
    }),
    initialProjectId: values.project === NO_PROJECT_OPTION ? null : values.project,
    outcome: enumValueOf({
      options: Object.values(ENewThreadOutcome),
      value: values.outcome,
      fallback: ENewThreadOutcome.Success,
    }),
    autoRun: values.autoRun,
  }
}
