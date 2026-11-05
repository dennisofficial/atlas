import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeEach, describe, expect, it } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { createDb } from '@dltech/atlas-db'
import { INBOX_KIND_MESSAGE } from '@dltech/atlas-protocol'
import type { ScriptedModelStep } from '@dltech/atlas-agent/testing'
import { ScriptedModel } from '@dltech/atlas-agent/testing'
import { RandomIds } from '../runtime/random-ids'
import { SessionHolder, systemTimers } from '@dltech/atlas-host'

import { LocalSandboxProvider } from '../testing/local-sandbox-provider'
import { createSessionRuntimeFactory } from '../runtime/session-runtime-factory'
import type { AgentHostApi } from '../config/agent-host-api'
import {
  CollectingLog,
  E2E_SECRET,
  makeInMemoryBus,
  waitForSeq,
  type ReadEvent,
} from './e2e-support'

const testDb = useTestDatabase()
const bus = makeInMemoryBus()

const git = (args: readonly string[], cwd: string): void => {
  execFileSync('git', [...args], { cwd, stdio: 'pipe' })
}

const bareRepoUrl = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-branches-e2e-'))
  const src = join(dir, 'src')
  git(['init', '-b', 'main', src], dir)
  git(['-C', src, 'config', 'user.email', 'e2e@example.com'], dir)
  git(['-C', src, 'config', 'user.name', 'e2e'], dir)
  execFileSync('sh', ['-c', 'echo seed > seed.txt && git add seed.txt && git commit -m seed'], {
    cwd: src,
    stdio: 'pipe',
  })
  const bare = join(dir, 'repo.git')
  git(['clone', '--bare', src, bare], dir)
  return `file://${bare}`
}

const apiWithRepo = (remoteUrl: string): AgentHostApi => ({
  config: async () => ({
    userId: 'user-1',
    projectId: 'proj-1',
    model: { configured: false, gap: 'scripted model in test' },
    vercel: { configured: true, token: '', teamId: '', projectId: '' },
    workspace: { remoteUrl, baseBranch: null, additionalRepos: [], setupScript: '' },
    config: {
      settings: {},
      secrets: [],
      harnessSecrets: [],
      mcpServers: [],
      fileMounts: [],
      provenance: {},
    },
    revision: 'rev-1',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }),
  modelAccessToken: async () => {
    throw new Error('unused')
  },
  githubToken: async () => ({ token: null }),
})

const branchRecords = (events: readonly ReadEvent[]): ReadEvent[] =>
  events.filter((row) => row.type === 'branches-observed')

const hasBranch = (row: ReadEvent, name: string): boolean => {
  const body = row.event as { branches?: { name: string }[] }
  return body.branches?.some((branch) => branch.name === name) ?? false
}

describe('branches-observed e2e', () => {
  const sandbox = new LocalSandboxProvider({ daemonSecret: E2E_SECRET })
  let plane: ControlPlane

  beforeEach(async () => {
    bus.reset()
    plane = new ControlPlane({ store: new PostgresControlStore(createDb(testDb().pool)) })
  })

  afterAll(async () => {
    await sandbox.stopAll()
  })

  it('records branch changes from the daemon git watch and stays quiet without them', async () => {
    const sessionId = 'e2e-branches-1'
    const mainThreadId = `thread-${sessionId}`
    const launchDirectory = join(
      mkdtempSync(join(tmpdir(), 'atlas-branches-e2e-workspace-')),
      'workspace',
    )
    const scripts: ScriptedModelStep[] = [
      {
        calls: [
          {
            callId: 'c1',
            name: 'bash',
            input: { description: 'branch', command: 'git checkout -b feat-x' },
          },
        ],
      },
      { text: 'done' },
      { text: 'done again' },
    ]
    await plane.createSession({
      sessionId,
      userId: 'user-1',
      projectId: 'proj-1',
      mainThreadId,
    })
    await plane.post({
      sessionId,
      kind: INBOX_KIND_MESSAGE,
      payload: JSON.stringify({ text: 'make a branch' }),
    })
    const timers = { now: () => Date.now(), ...systemTimers }
    const log = new CollectingLog()
    const holder = new SessionHolder({
      holderId: 'host-branches',
      plane,
      bus,
      timers,
      runtimes: createSessionRuntimeFactory({
        api: apiWithRepo(bareRepoUrl()),
        sandbox,
        daemonSecret: E2E_SECRET,
        timers,
        modelFor: () => new ScriptedModel(scripts),
        launchDirectory,
        log,
      }),
      log,
      ids: new RandomIds(),
      maxSessions: 25,
      ttlMs: 30_000,
      renewEveryMs: 5_000,
      fenceMarginMs: 5_000,
      idleMinutes: 30,
    })
    await holder.start()
    await bus.wake(sessionId)

    const first = await waitForSeq({
      plane,
      threadId: mainThreadId,
      want: (rows) => branchRecords(rows).some((row) => hasBranch(row, 'feat-x')),
    }).catch(async (error: unknown) => {
      const rows = await plane.readEvents({
        threadId: mainThreadId,
        afterSeq: 0,
        limit: 100,
        visible: true,
      })
      const bodies = rows.events.map((row) => JSON.stringify(row)).join('\n')
      throw new Error(`${String(error)}\n${log.dump('branches-e2e')}\n${bodies}`)
    })
    expect(branchRecords(first)).toHaveLength(1)

    await plane.post({
      sessionId,
      kind: INBOX_KIND_MESSAGE,
      payload: JSON.stringify({ text: 'just reply' }),
    })
    await bus.wake(sessionId)
    await waitForSeq({
      plane,
      threadId: mainThreadId,
      want: (rows) => rows.filter((row) => row.type === 'assistant-said').length >= 2,
    })
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    const after = await waitForSeq({
      plane,
      threadId: mainThreadId,
      want: (rows) => rows.filter((row) => row.type === 'assistant-said').length >= 2,
    })
    expect(branchRecords(after)).toHaveLength(1)
  }, 60_000)
})
