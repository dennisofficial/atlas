import { ETodoStatus, type ContextNode, type TodoTask } from './details-model'

export const HEAD = {
  turns: '12 turns',
  cost: '$4.83',
  tokens: '↑ 312.4k  ↓ 84.1k  cache 2.31m',
}

export const POD_REGION = 'iad1'

export const FOOTER_PATHS = [
  '/atlas/workspaces/atlas',
  '/atlas/workspaces/atlas/.atlas/worktrees/dennis/web-details-pane',
]

export enum EProcessTone {
  Running = 'running',
  Done = 'done',
  Failed = 'failed',
}

export interface ProcessRow {
  id: string
  name: string
  readout: string
  tone: EProcessTone
}

export const SHELLS: ProcessRow[] = [
  { id: 'sh-1', name: 'bun test --watch', readout: '14m', tone: EProcessTone.Running },
  { id: 'sh-2', name: 'tsc --noEmit -w', readout: '9m', tone: EProcessTone.Running },
]

export const SERVICES: ProcessRow[] = [
  { id: 'sv-1', name: 'storybook', readout: ':6006', tone: EProcessTone.Running },
  { id: 'sv-2', name: 'prototype', readout: 'exit 0', tone: EProcessTone.Done },
  { id: 'sv-3', name: 'webterm', readout: 'killed', tone: EProcessTone.Done },
  { id: 'sv-4', name: 'api', readout: 'exit 1', tone: EProcessTone.Failed },
]

export const SERVICES_HIDDEN = { hidden: 2, failed: true }

export interface GrantRow {
  id: string
  subject: string
  dimensions: string[]
}

export const GRANTS: GrantRow[] = [
  { id: 'gr-1', subject: 'github.com', dimensions: ['network', 'read'] },
  { id: 'gr-2', subject: 'bun install', dimensions: ['shell', 'write'] },
]

export const TODOS: TodoTask[] = [
  { id: 't-1', text: 'Map tokens onto variables', status: ETodoStatus.Done },
  { id: 't-2', text: 'Regenerate theme.css', status: ETodoStatus.Done },
  { id: 't-3', text: 'Restyle the diff viewer', status: ETodoStatus.Done },
  { id: 't-4', text: 'Run typecheck', status: ETodoStatus.Done },
  {
    id: 't-5',
    text: 'Run the ui specs',
    activeForm: 'Running the ui specs',
    status: ETodoStatus.Running,
  },
]

export interface SubscriptionRow {
  id: string
  label: string
  detail: string
  paused: boolean
}

export const SUBSCRIPTIONS: SubscriptionRow[] = [
  { id: 'sb-1', label: 'pr:1469', detail: '2 held · by Dennis', paused: false },
  { id: 'sb-2', label: 'ci:main', detail: 'expires in 2h · by Atlas', paused: false },
]

export const CONTEXT_TREE: ContextNode[] = [
  {
    name: 'plans',
    path: 'plans',
    children: [
      {
        name: 'details-pane.md',
        path: 'plans/details-pane.md',
        content: [
          '# Details pane',
          '',
          'The **Details** tab is the default view of a thread.',
          '',
          '## Sections',
          '',
          '- Head and pod status',
          '- Context files, opened in the main column',
          '- Todo, crew and subscriptions',
          '',
          '## Open questions',
          '',
          '1. Should folds remember their state?',
          '2. Keep the composer below the viewer?',
          '',
          '> Files open where the transcript was.',
          '',
          '```ts',
          "const viewer = 'replaces the transcript'",
          '```',
          '',
        ].join('\n'),
      },
      {
        name: 'notes',
        path: 'plans/notes',
        children: [
          {
            name: 'folds.md',
            path: 'plans/notes/folds.md',
            content:
              'Todo folds after two done.\nServices keep three settled.\nCrew folds settled rows.\n',
          },
        ],
      },
    ],
  },
  {
    name: 'memory',
    path: 'memory',
    children: [
      {
        name: 'feedback.md',
        path: 'memory/feedback.md',
        content: 'Prefer small PRs.\nNever commit without asking.\n',
      },
    ],
  },
  {
    name: 'ATLAS.md',
    path: 'ATLAS.md',
    content: '# Atlas\n\nCoding-agent harness.\nRead docs/architecture.md first.\n',
  },
]
