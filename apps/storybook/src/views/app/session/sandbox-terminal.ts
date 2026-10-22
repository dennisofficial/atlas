import { BUN_TEST_OUTPUT } from '../../../fixtures/agent'

export enum ETerminalConnection {
  Connecting = 'connecting',
  Connected = 'connected',
  Paused = 'paused',
  Disconnected = 'disconnected',
}

export enum ETerminalEntry {
  Command = 'command',
  Output = 'output',
}

export interface CommandEntry {
  kind: ETerminalEntry.Command
  cwd: string
  command: string
}

export interface OutputEntry {
  kind: ETerminalEntry.Output
  text: string
}

export type TerminalEntry = CommandEntry | OutputEntry

export interface UserTerminal {
  id: string
  label: string
  cwd: string
  host?: string
  entries: TerminalEntry[]
}

export const SANDBOX = {
  user: 'dennis',
  host: 'pod',
  branch: 'dennis/app-shell',
  size: '4 vCPU · 8 GB',
}

interface RunInput {
  cwd: string
  command: string
  output?: string
}

function run({ cwd, command, output }: RunInput): TerminalEntry[] {
  const entry: CommandEntry = { kind: ETerminalEntry.Command, cwd, command }
  if (output === undefined) return [entry]
  return [entry, { kind: ETerminalEntry.Output, text: output }]
}

const GIT_STATUS = `On branch dennis/app-shell
Your branch is up to date with 'origin/dennis/app-shell'.

Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
        modified:   apps/storybook/src/views/app/session/terminal-tab.tsx

Untracked files:
  (use "git add <file>..." to include in what will be committed)
        apps/storybook/src/views/app/session/sandbox-terminal.ts

no changes added to commit (use "git add" and/or "git commit -a")`

const LS = `AGENTS.md  CLAUDE.md  apps  bun.lock  bunfig.toml  deprecated  docs  package.json  packages  turbo.json`

const GIT_LOG = `4292196e1 (HEAD -> dennis/app-shell, origin/main) refactor(ui): rebase atlas-ui on shadcn base-nova
ef0201093 feat(api): register and lease a per-user ssh signing key
8d169fdca feat(tui): start every new thread in a local docker pod`

const WORKSPACE = '~/workspace'
const WEB = '~/workspace/apps/web'

export const INITIAL_TERMINALS: UserTerminal[] = [
  {
    id: 'term-1',
    label: 'Terminal 1',
    cwd: WORKSPACE,
    entries: [
      {
        kind: ETerminalEntry.Output,
        text: 'Connected to thr-ui-rebase · Ubuntu 24.04 · bun 1.3.4',
      },
      ...run({ cwd: WORKSPACE, command: 'git status', output: GIT_STATUS }),
      ...run({ cwd: WORKSPACE, command: 'ls', output: LS }),
      ...run({
        cwd: WORKSPACE,
        command: 'bun run test --filter @dltech/atlas-ui',
        output: BUN_TEST_OUTPUT,
      }),
    ],
  },
  {
    id: 'term-2',
    label: 'Terminal 2',
    cwd: WEB,
    entries: [
      ...run({ cwd: WORKSPACE, command: 'cd apps/web' }),
      ...run({ cwd: WEB, command: 'git log --oneline -3', output: GIT_LOG }),
    ],
  },
]
