import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeEach, describe, expect, it } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { EMessageOrigin } from '@dltech/atlas-core'
import { createDb } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
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
  const dir = mkdtempSync(join(tmpdir(), 'atlas-base-restart-'))
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
      vercel: { configured: true, token: '', teamId: '', projectId: '' },
      workspace: { remoteUrl, baseBranch: null, additionalRepos: [], setupScript: '' },
      sandboxVcpus: undefined,
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

const branchStep = (args: { callId: string; branch: string }): ScriptedModelStep => ({
  calls: [
    {
      callId: args.callId,
      name: 'bash',
      input: { description: 'branch', command: `git checkout -b ${args.branch}` },
    },
  ],
})

describe('the session base across a host restart', () => {
  const sandbox = new LocalSandboxProvider({ daemonSecret: E2E_SECRET })
  let plane: ControlPlane
  const holders: SessionHolder[] = []

  beforeEach(() => {
    bus.reset()
    plane = new ControlPlane({ store: new PostgresControlStore(createDb(testDb().pool)) })
  })

  afterAll(async () => {
    for (const held of holders) await held.drain()
    await sandbox.stopAll()
  })

  const hostOn = (args: {
    label: string
    remoteUrl: string
    launchDirectory: string
    scripts: readonly ScriptedModelStep[]
    log: CollectingLog
  }): SessionHolder => {
    const timers = { now: () => Date.now(), ...systemTimers }
    return new SessionHolder({
      presence: makePresence({ url: testDb().url, label: args.label }),
      plane,
      bus,
      timers,
      runtimes: createSessionRuntimeFactory({
        config: sourceWithRepo(args.remoteUrl),
        tokens: unusedTokens(),
        github: noGithub(),
        sandbox,
        daemonSecret: E2E_SECRET,
        timers,
        modelFor: () => new ScriptedModel([...args.scripts]),
        launchDirectory: args.launchDirectory,
        log: args.log,
      }),
      log: args.log,
      ids: new RandomIds(),
      maxSessions: 25,
      idleMinutes: 30,
    })
  }

  it('keeps the captured base when a new host takes a materialized workspace', async () => {
    const sessionId = 'e2e-base-restart'
    const mainThreadId = `thread-${sessionId}`
    const remoteUrl = bareRepoUrl()
    const launchDirectory = join(
      mkdtempSync(join(tmpdir(), 'atlas-base-restart-workspace-')),
      'workspace',
    )
    await plane.createSession({ sessionId, userId: 'user-1', projectId: 'proj-1', mainThreadId })
    const firstLog = new CollectingLog()
    const first = hostOn({
      label: 'host-base-a',
      remoteUrl,
      launchDirectory,
      log: firstLog,
      scripts: [branchStep({ callId: 'c1', branch: 'feat-x' }), { text: 'on feat-x' }],
    })
    holders.push(first)
    await first.start()
    await plane.post({
      sessionId,
      kind: INBOX_KIND_MESSAGE,
      payload: JSON.stringify({ text: 'branch off', via: EMessageOrigin.Operator }),
    })
    await bus.wake(sessionId)
    const before = await waitForSeq({
      plane,
      threadId: mainThreadId,
      want: (rows) =>
        branchRecords(rows).some((row) => hasBranch(row, 'feat-x')) &&
        rows.some((row) => row.type === 'assistant-said'),
    })
    const observedBefore = branchRecords(before)
    expect(observedBefore.map((row) => hasBranch(row, 'feat-x'))).toEqual([false, true])
    expect(observedBefore.map(baseOf)).toEqual(['main', 'main'])
    const lastSeqBeforeRestart = before.at(-1)?.seq ?? 0
    await first.drain()

    const secondLog = new CollectingLog()
    const second = hostOn({
      label: 'host-base-b',
      remoteUrl,
      launchDirectory,
      log: secondLog,
      scripts: [branchStep({ callId: 'c1', branch: 'feat-y' }), { text: 'on feat-y' }],
    })
    holders.push(second)
    await second.start()
    await plane.post({
      sessionId,
      kind: INBOX_KIND_MESSAGE,
      payload: JSON.stringify({ text: 'branch again', via: EMessageOrigin.Operator }),
    })
    await bus.wake(sessionId)
    const after = await waitForSeq({
      plane,
      threadId: mainThreadId,
      want: (rows) =>
        branchRecords(rows).some(
          (row) => row.seq > lastSeqBeforeRestart && hasBranch(row, 'feat-y'),
        ),
    }).catch(async (error: unknown) => {
      const rows = await plane.readEvents({
        threadId: mainThreadId,
        afterSeq: 0,
        limit: 200,
        visible: true,
      })
      const bodies = rows.events.map((row) => `${row.seq}:${row.type}:${JSON.stringify(row)}`)
      throw new Error(`${String(error)}\n${secondLog.dump('base-restart')}\n${bodies.join('\n')}`)
    })
    const restarted = branchRecords(after).filter((row) => row.seq > lastSeqBeforeRestart)
    expect(restarted.length).toBeGreaterThan(0)
    expect(restarted.map(baseOf)).toEqual(restarted.map(() => 'main'))
  }, 120_000)
})
