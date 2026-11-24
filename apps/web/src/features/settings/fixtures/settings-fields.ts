import { EVerdictTiming } from '@dltech/atlas-wire/web'

import { ESettingFieldKind, type SettingField } from '../data/personal/setting-fields'

const toggle = (args: {
  key: string
  title: string
  description: string
  fallback: boolean
}): SettingField => ({
  kind: ESettingFieldKind.Toggle,
  ...args,
})

export const CONTEXT_FIELDS: SettingField[] = [
  toggle({
    key: 'skills.suggest',
    title: 'Suggest a skill per turn',
    description:
      'Before each turn, the classifier scores the likely skills against the thread and names at most one to the agent as a hint it can ignore. Off when the classifier is off.',
    fallback: true,
  }),
  {
    kind: ESettingFieldKind.Range,
    key: 'context.autoRotate',
    title: 'Rotate the context automatically at',
    description:
      'How full the context window may get before Atlas rotates the thread by itself: one model call writes a handoff brief, a marker goes into the transcript, and the next turn starts from the brief. Checked when a turn ends, so a turn is never interrupted. Zero rotates only when you ask with /rotate.',
    fallback: 85,
    min: 0,
    max: 100,
    step: 5,
    unit: '%',
  },
  {
    kind: ESettingFieldKind.Choice,
    key: 'worktree.directory',
    title: 'Where worktrees go',
    description:
      'The directory, relative to the repository root, that enter_worktree creates a worktree in. Atlas gitignores it.',
    fallback: '.atlas/worktrees',
    options: [
      { value: '.atlas/worktrees', label: '.atlas/worktrees' },
      { value: '.worktrees', label: '.worktrees' },
    ],
  },
]

export const EXPERIMENTAL_FIELDS: SettingField[] = [
  toggle({
    key: 'experimental.grillingCeremony',
    title: 'Grilling ceremony',
    description:
      'Plan feature-sized work by interviewing you first: one question at a time, with a recommended answer, capturing each decision as it settles.',
    fallback: false,
  }),
  {
    kind: ESettingFieldKind.Choice,
    key: 'github.prEvents.verdictTiming',
    title: 'CI verdict timing',
    description:
      'When a pull request’s checks count as a verdict that wakes a parked sandbox. Fail fast reports the first failed check; settled waits for every check.',
    fallback: EVerdictTiming.FailFast,
    options: [
      { value: EVerdictTiming.FailFast, label: 'Fail fast' },
      { value: EVerdictTiming.Settled, label: 'Settled' },
    ],
  },
]

export const QUALITY_FIELDS: SettingField[] = [
  toggle({
    key: 'quality.enabled',
    title: 'Code quality review',
    description:
      'Runs whenever a classifier is set on the Classifier settings page, and is off without one. After a file write, the classifier reviews the changed scope against the enabled policies and may leave the agent a one-time nudge. It never blocks or reverts a write.',
    fallback: true,
  }),
]
