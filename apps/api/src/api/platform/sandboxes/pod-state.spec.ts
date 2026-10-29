import { EBootStepState, EPodState } from '@dltech/atlas-wire'
import type { Row } from '@dltech/atlas-db'
import { describe, expect, it } from 'bun:test'
import { podStateOf } from './pod-state'

const NOW = new Date()
const AGO = (ms: number) => new Date(NOW.getTime() - ms)

const sandbox = (partial: Partial<Row<'CloudSandbox'>> = {}): Row<'CloudSandbox'> => ({
  id: 'sbx',
  sessionId: 'ses_thr',
  userId: 'user-a',
  sandboxId: 'sandbox-id',
  name: 'name',
  region: 'iad1',
  state: 'parked',
  lastActivityAt: NOW,
  tokenHash: 'hash',
  sealedToken: null,
  sealedGitToken: null,
  workspaceRemoteUrl: null,
  contextPending: true,
  pinnedModel: null,
  serveUrl: null,
  serveVersion: null,
  wakeFailedAt: null,
  wakeClaim: null,
  pendingSend: null,
  runtimeCheckpoint: null,
  runtimeCheckpointRevision: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...partial,
})

const CASES: {
  name: string
  row: Row<'CloudSandbox'> | null
  last: EBootStepState | undefined
  expected: EPodState
}[] = [
  { name: 'no row', row: null, last: undefined, expected: EPodState.None },
  {
    name: 'no row, errored boot',
    row: null,
    last: EBootStepState.Error,
    expected: EPodState.Failed,
  },
  {
    name: 'running with serve url',
    row: sandbox({ state: 'running', serveUrl: 'https://x' }),
    last: undefined,
    expected: EPodState.Running,
  },
  {
    name: 'running beats an old boot error',
    row: sandbox({ state: 'running', serveUrl: 'https://x' }),
    last: EBootStepState.Error,
    expected: EPodState.Running,
  },
  {
    name: 'active wake claim',
    row: sandbox({ wakeClaim: AGO(1_000) }),
    last: undefined,
    expected: EPodState.Booting,
  },
  {
    name: 'wake failed after claim',
    row: sandbox({ wakeClaim: AGO(5_000), wakeFailedAt: AGO(1_000) }),
    last: undefined,
    expected: EPodState.Failed,
  },
  {
    name: 'parked row',
    row: sandbox(),
    last: undefined,
    expected: EPodState.Parked,
  },
  {
    name: 'parked row with errored boot',
    row: sandbox(),
    last: EBootStepState.Error,
    expected: EPodState.Failed,
  },
  {
    name: 'stale wake claim parks',
    row: sandbox({ wakeClaim: AGO(60 * 60 * 1_000) }),
    last: undefined,
    expected: EPodState.Parked,
  },
]

describe('podStateOf', () => {
  for (const { name, row, last, expected } of CASES) {
    it(name, () => {
      expect(podStateOf({ row, lastBootStepState: last })).toBe(expected)
    })
  }
})
