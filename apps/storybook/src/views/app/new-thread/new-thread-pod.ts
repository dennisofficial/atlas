import { EFileChange, type ChangedFile } from '@dltech/atlas-ui/ai/changes-panel'
import type { DiffLine } from '@dltech/atlas-ui/ai/diff-viewer'
import type { FileNode } from '@dltech/atlas-ui/ai/file-tree'
import { EToolKind } from '@dltech/atlas-ui/ai/tool'

import { ETerminalEntry, type UserTerminal } from '../session/sandbox-terminal'
import { EPodPhase, type PodPanelState } from '../session/pod-state'
import { EPodState, RUNNING_POD, type PodChipConfig } from '../session/pod-status'
import { FIRST_TURN_STEPS } from './new-thread-data'
import { EPodProgress, isFailedPod, isStartingPod } from './new-thread-types'

const SPEC_PATH = 'apps/serve/src/__tests__/reconnect.spec.ts'

const SPEC_LINES: DiffLine[] = [
  {
    kind: 'context',
    text: '  it("reconnects after the socket closes", async () => {',
    oldNumber: 84,
    newNumber: 84,
  },
  { kind: 'remove', text: '    socket.close();', oldNumber: 85 },
  { kind: 'add', text: "    const closed = once(socket, 'close');", newNumber: 85 },
  { kind: 'add', text: '    socket.close();', newNumber: 86 },
  { kind: 'add', text: '    await closed;', newNumber: 87 },
  {
    kind: 'context',
    text: '    expect(client.state).toBe(EConnection.Reconnecting);',
    oldNumber: 86,
    newNumber: 88,
  },
]

const SPEC_FILE: ChangedFile = {
  path: SPEC_PATH,
  added: 3,
  removed: 1,
  change: EFileChange.Modified,
  hunk: '@@ -84,5 +84,7 @@',
  lines: SPEC_LINES,
}

const WORKSPACE_FILES: FileNode[] = [
  {
    path: 'apps/serve',
    name: 'apps/serve',
    children: [
      {
        path: 'apps/serve/src',
        name: 'src',
        children: [
          { path: 'apps/serve/src/server.ts', name: 'server.ts' },
          {
            path: 'apps/serve/src/__tests__',
            name: '__tests__',
            children: [
              { path: SPEC_PATH, name: 'reconnect.spec.ts', change: EFileChange.Modified },
            ],
          },
        ],
      },
      { path: 'apps/serve/package.json', name: 'package.json' },
    ],
  },
]

const EDIT_STEP_COUNT = FIRST_TURN_STEPS.findIndex((step) => step.kind === EToolKind.Edit) + 1

const READY_TERMINAL: UserTerminal = {
  id: 'term-1',
  label: 'Terminal 1',
  cwd: '~/workspace',
  host: 'pod',
  entries: [
    { kind: ETerminalEntry.Output, text: 'Connected to pod · Ubuntu 24.04 · bun 1.4.2' },
    { kind: ETerminalEntry.Command, cwd: '~/workspace', command: 'git status --short' },
  ],
}

const IDLE_TERMINAL: UserTerminal = { ...READY_TERMINAL, entries: [] }

export function phaseOf(pod: EPodProgress): EPodPhase {
  if (pod === EPodProgress.None) return EPodPhase.None
  if (isStartingPod(pod)) return EPodPhase.Starting
  return isFailedPod(pod) ? EPodPhase.Failed : EPodPhase.Ready
}

export function podChipOf(pod: EPodProgress): PodChipConfig | undefined {
  const phase = phaseOf(pod)
  if (phase === EPodPhase.Starting) return { status: { ...RUNNING_POD, state: EPodState.Starting } }
  return phase === EPodPhase.Ready ? { status: RUNNING_POD } : undefined
}

interface PodStateInput {
  pod: EPodProgress
  projectId: string | null
  visibleSteps: number
  onRetry: () => void
}

export function podStateOf({
  pod,
  projectId,
  visibleSteps,
  onRetry,
}: PodStateInput): PodPanelState {
  const phase = phaseOf(pod)
  const ready = phase === EPodPhase.Ready
  return {
    phase,
    terminals: [ready ? READY_TERMINAL : IDLE_TERMINAL],
    files: ready && projectId !== null ? WORKSPACE_FILES : [],
    changedFiles: ready && projectId !== null && visibleSteps >= EDIT_STEP_COUNT ? [SPEC_FILE] : [],
    onRetry,
  }
}
