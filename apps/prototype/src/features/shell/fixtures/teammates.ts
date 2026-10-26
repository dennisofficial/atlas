import { SESSION_THREAD_ID } from './app'

export enum EAgentStatus {
  Running = 'running',
  Finished = 'finished',
  Failed = 'failed',
  Stopped = 'stopped',
  Blocked = 'blocked',
  Paused = 'paused',
}

export enum ESandboxState {
  Booting = 'booting',
  Ready = 'ready',
}

export interface AppTeammate {
  id: string
  parentId: string
  title: string
  run: EAgentStatus
  sandbox: ESandboxState
  branch: string
  brief: string
  outcome?: string
}

export const TEAMMATES: AppTeammate[] = [
  {
    id: 'tm-theme-gen',
    parentId: SESSION_THREAD_ID,
    title: 'Generate theme.css from tokens',
    run: EAgentStatus.Running,
    sandbox: ESandboxState.Ready,
    branch: 'dennis/tokens-theme-gen',
    brief:
      'Generate packages/ui/src/styles/theme.css from the token modules in packages/ui/src/tokens. Keep the existing variable names and add the diff surface tokens. Never hand-edit the generated file.',
  },
  {
    id: 'tm-gutter-tokens',
    parentId: SESSION_THREAD_ID,
    title: 'Diff viewer gutter tokens',
    run: EAgentStatus.Blocked,
    sandbox: ESandboxState.Ready,
    branch: 'dennis/diff-gutter-tokens',
    brief:
      'Move the diff viewer gutter and word-highlight colors onto semantic tokens. Keep the viewer visually unchanged in dark mode.',
  },
  {
    id: 'tm-render-check',
    parentId: SESSION_THREAD_ID,
    title: 'Storybook render check',
    run: EAgentStatus.Running,
    sandbox: ESandboxState.Booting,
    branch: 'dennis/render-check',
    brief:
      'Run the storybook render check against every story the rebase touches and list the ones that fail to mount.',
  },
  {
    id: 'tm-typecheck-ai',
    parentId: SESSION_THREAD_ID,
    title: 'Typecheck the ai patterns',
    run: EAgentStatus.Failed,
    sandbox: ESandboxState.Ready,
    branch: 'dennis/ai-typecheck',
    brief:
      'Run tsc over packages/ui/src/ai and fix the type errors the new base-nova components introduced.',
    outcome: 'tsc ran out of memory in the sandbox, so I stopped before fixing the type errors.',
  },
  {
    id: 'tm-legacy-home',
    parentId: SESSION_THREAD_ID,
    title: 'Drop the legacy home page',
    run: EAgentStatus.Finished,
    sandbox: ESandboxState.Ready,
    branch: 'dennis/drop-legacy-home',
    brief:
      'Delete the legacy home page and its stories from the storybook app. Update anything that imported it.',
    outcome:
      'Deleted the legacy home page and its stories. Typecheck and specs pass; PR #1318 is open.',
  },
  {
    id: 'tm-stopped-codemod',
    parentId: SESSION_THREAD_ID,
    title: 'Codemod icon imports',
    run: EAgentStatus.Stopped,
    sandbox: ESandboxState.Ready,
    branch: 'dennis/icon-import-codemod',
    brief:
      'Rewrite every direct icon import in the storybook app to go through the shared icon barrel.',
  },
]

export function teammatesOf(parentId: string): AppTeammate[] {
  return TEAMMATES.filter((teammate) => teammate.parentId === parentId)
}

export function findTeammate(id: string): AppTeammate | undefined {
  return TEAMMATES.find((teammate) => teammate.id === id)
}
