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
    key: 'context.projectInstructions',
    title: 'Project instructions',
    description:
      'Load the instruction files a repository carries for its agents. A deeper file overrides a shallower one.',
    fallback: true,
  }),
  toggle({
    key: 'context.userInstructions',
    title: 'Personal instructions',
    description:
      'Also load your own ATLAS.md, which applies to every project. The repository wins any disagreement with it.',
    fallback: true,
  }),
  {
    kind: ESettingFieldKind.Choice,
    key: 'context.filenames',
    title: 'Borrowed instruction files',
    description:
      'Which instruction files from other harnesses a repository is read for. ATLAS.md is always read and loaded last.',
    fallback: 'both',
    options: [
      { value: 'both', label: 'AGENTS.md + CLAUDE.md' },
      { value: 'claude', label: 'CLAUDE.md' },
      { value: 'agents', label: 'AGENTS.md' },
      { value: 'none', label: 'Neither' },
    ],
  },
  {
    kind: ESettingFieldKind.Text,
    key: 'plugins.trustedRepos',
    title: 'Trusted repositories',
    description:
      'Repositories whose .atlas/plugins may run, comma separated, as host/owner/repo. Takes effect on the next session.',
    fallback: '',
    placeholder: 'github.com/acme/widget',
  },
  toggle({
    key: 'context.reload',
    title: 'Reload on change',
    description:
      'Re-read the instruction files every turn, so an edit takes effect in the conversation you are already in. Off freezes them as they were when it opened.',
    fallback: true,
  }),
  toggle({
    key: 'skills.suggest',
    title: 'Suggest a skill per turn',
    description:
      'Before each turn, the decision model ranks every skill against your message and names at most one to the agent as a hint it can ignore.',
    fallback: true,
  }),
  {
    kind: ESettingFieldKind.Range,
    key: 'context.autoCompact',
    title: 'Compact automatically at',
    description:
      'How full the context window may get before Atlas summarises older turns. Checked when a turn ends. Zero compacts only on /compact.',
    fallback: 90,
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

export const SANDBOX_FIELDS: SettingField[] = [
  {
    kind: ESettingFieldKind.Range,
    key: 'sandbox.vcpus',
    title: 'Sandbox size',
    description:
      'vCPUs a new cloud sandbox boots with, and 2 GB of RAM per vCPU. Applies at creation. Above 8 needs a Vercel Enterprise plan.',
    fallback: 2,
    min: 2,
    max: 8,
    step: 2,
    unit: ' vcpu',
  },
  {
    kind: ESettingFieldKind.Text,
    key: 'sandbox.image',
    title: 'Sandbox image',
    description:
      'The image a cloud sandbox boots. Point this at your own build when your Vercel team cannot pull the published one.',
    fallback: 'atlas-sandbox:latest',
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
      'After a file write, a decision model reviews the changed scope against the enabled policies and may leave the agent a one-time nudge. It never blocks or reverts a write.',
    fallback: false,
  }),
  toggle({
    key: 'quality.recordExamples',
    title: 'Record examples',
    description:
      'Save the source of each reviewed change, before and after, as an example file under the conversation’s data directory.',
    fallback: false,
  }),
]
