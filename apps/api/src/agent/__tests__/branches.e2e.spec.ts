import { execFileSync } from 'node:child_process'
import { ESandboxProvider } from '@dltech/atlas-protocol'
import { singleProviderRegistry } from '../testing/sandbox-registry'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeEach, describe, expect, it } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
import { EMessageOrigin } from '@dltech/atlas-core'
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
import { fakeModelSourceOf } from '../testing/model-source'
import type { ConfigSource } from '../config/agent-host-config'
import {
  CollectingLog,
  E2E_SECRET,
  makeInMemoryBus,
  makePresence,
  noGithub,
  readAllEvents,
  unusedTokens,
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

const sourceWithRepo = (remoteUrl: string): ConfigSource => ({
  read: async () => {
    const model = { configured: false as const, gap: 'scripted model in test' }
    return {
      userId: 'user-1',
      projectId: 'proj-1',
      model,
      models: fakeModelSourceOf(model),
      classifier: { on: false, reason: 'no classifier model is set' },
      quality: { enabled: false, policies: {} },
      rotation: { autoRotateAtPercent: 85 },
      sandbox: {
        configured: true,
        provider: ESandboxProvider.Vercel,
        credentials: { provider: ESandboxProvider.Vercel, token: '', teamId: '', projectId: '' },
      },
      workspace: { remoteUrl, baseBranch: null, additionalRepos: [], setupScript: '' },
      skills: [],
    }
  },
  models: async () => fakeModelSourceOf({ configured: false, gap: 'scripted model in test' }),
})

const branchRecords = (events: readonly ReadEvent[]): ReadEvent[] =>
  events.filter((row) => row.type === 'branches-observed')

const hasBranch = (row: ReadEvent, name: string): boolean => {
  const body = row.event as { branches?: { name: string }[] }
  return body.branches?.some((branch) => branch.name === name) ?? false
}

const baseOf = (row: ReadEvent): string | null =>
  (row.event as { base?: string | null }).base ?? null

const lastBranchRecord = (events: readonly ReadEvent[]): ReadEvent => {
  const row = branchRecords(events).at(-1)
  if (row === undefined) throw new Error('no branches-observed record')
  return row
}

const QUIET_POLL_MS = 150
const QUIET_POLLS = 5

const waitForBranchQuiet = async (args: {
  plane: ControlPlane
  threadId: string
}): Promise<ReadEvent[]> => {
  const deadline = Date.now() + 30_000
  let shape = ''
  let stable = 0
  while (Date.now() < deadline) {
    const rows = await readAllEvents({ plane: args.plane, threadId: args.threadId })
    const seen = branchRecords(rows)
      .map((row) => `${row.seq}:${hasBranch(row, 'feat-x')}`)
      .join(',')
    stable = seen === shape ? stable + 1 : 0
    shape = seen
    if (stable >= QUIET_POLLS) return rows
    await new Promise((resolve) => setTimeout(resolve, QUIET_POLL_MS))
  }
  throw new Error(`branch observations never settled; last: ${shape}`)
}

describe('branches-observed e2e', () => {
  const sandbox = new LocalSandboxProvider({ daemonSecret: E2E_SECRET })
  let plane: ControlPlane
  const holders: SessionHolder[] = []

  beforeEach(async () => {
    bus.reset()
    plane = new ControlPlane({ store: new PostgresControlStore(createDb(testDb().pool)) })
  })

  afterAll(async () => {
    for (const held of holders) await held.drain()
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
    const timers = { now: () => Date.now(), ...systemTimers }
    const log = new CollectingLog()
    const holder = new SessionHolder({
      presence: makePresence({ url: testDb().url, label: 'host-branches' }),
      plane,
      bus,
      timers,
      runtimes: createSessionRuntimeFactory({
        config: sourceWithRepo(bareRepoUrl()),
        tokens: unusedTokens(),
        github: noGithub(),
        sandbox: singleProviderRegistry(sandbox),
        daemonSecret: E2E_SECRET,
        timers,
        modelFor: () => new ScriptedModel(scripts),
        launchDirectory,
        log,
      }),
      log,
      ids: new RandomIds(),
    })
    holders.push(holder)
    await holder.start()
    const boot = await waitForSeq({
      plane,
      threadId: mainThreadId,
      want: (rows) => branchRecords(rows).length > 0,
    })
    expect(branchRecords(boot).map((row) => hasBranch(row, 'feat-x'))).toEqual([false])
    expect(branchRecords(boot).map(baseOf)).toEqual(['main'])

    await plane.post({
      sessionId,
      kind: INBOX_KIND_MESSAGE,
      payload: JSON.stringify({ text: 'make a branch', via: EMessageOrigin.Operator }),
    })
    await bus.wake(sessionId)

    await waitForSeq({
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
    const settled = await waitForBranchQuiet({ plane, threadId: mainThreadId })
    expect(hasBranch(lastBranchRecord(settled), 'feat-x')).toBe(true)
    expect(branchRecords(settled).map(baseOf)).toEqual(branchRecords(settled).map(() => 'main'))

    await plane.post({
      sessionId,
      kind: INBOX_KIND_MESSAGE,
      payload: JSON.stringify({ text: 'just reply', via: EMessageOrigin.Operator }),
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
    expect(branchRecords(after).length).toBe(branchRecords(settled).length)
    expect(hasBranch(lastBranchRecord(after), 'feat-x')).toBe(true)
  }, 60_000)
})
