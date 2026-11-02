import { ETodoStatus, type ContextNode, type TodoTask } from './details-model'

export const FOOTER_PATHS = [
  '/atlas/workspaces/atlas',
  '/atlas/workspaces/atlas/.atlas/worktrees/dennis/web-details-pane',
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
