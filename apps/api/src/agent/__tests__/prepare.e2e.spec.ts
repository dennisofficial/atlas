import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeEach, describe, expect, it } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
import { EMessageOrigin } from '@dltech/atlas-core'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { createDb } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { INBOX_KIND_MESSAGE } from '@dltech/atlas-protocol'

import { LocalSandboxProvider } from '../testing/local-sandbox-provider'
import {
  E2E_SECRET,
  makeHolder,
  makeInMemoryBus,
  makePresence,
  waitForSeq,
  type ReadEvent,
} from './e2e-support'

const testDb = useTestDatabase()
const bus = makeInMemoryBus()

const typesOf = (rows: readonly ReadEvent[]): string[] => rows.map((row) => row.type)

describe('agent-host prepares a new session before its first turn', () => {
  const sandbox = new LocalSandboxProvider({ daemonSecret: E2E_SECRET })
  let plane: ControlPlane

  beforeEach(() => {
    bus.reset()
    plane = new ControlPlane({ store: new PostgresControlStore(createDb(testDb().pool)) })
  })

  afterAll(async () => {
    await sandbox.stopAll()
  })

  const newSession = async (args: { sessionId: string; text: string }): Promise<string> => {
    const mainThreadId = `thread-${args.sessionId}`
    await plane.createSession({
      sessionId: args.sessionId,
      userId: 'user-1',
      projectId: 'proj-1',
      mainThreadId,
    })
    await plane.post({
      sessionId: args.sessionId,
      kind: INBOX_KIND_MESSAGE,
      payload: JSON.stringify({ text: args.text, via: EMessageOrigin.Operator }),
    })
    return mainThreadId
  }

  it('answers the first message before the background setup script ends', async () => {
    const sessionId = 'prepare-e2e-1'
    const mainThreadId = await newSession({ sessionId, text: 'hello' })
    const launchDirectory = join(mkdtempSync(join(tmpdir(), 'atlas-prepare-e2e-')), 'workspace')
    const holder = makeHolder({
      presence: makePresence({ url: testDb().url, label: 'host-a' }),
      plane,
      bus,
      sandbox,
      scripts: { [sessionId]: [{ text: 'hi there' }, { text: 'noted the setup' }] },
      setupScript: 'sleep 3 && echo ready > prepared.txt',
      launchDirectory,
    })
    await holder.start()
    await bus.wake(sessionId)

    const events = await waitForSeq({
      plane,
      threadId: mainThreadId,
      want: (rows) =>
        rows.filter((row) => row.type === 'sandbox-setup-reported').length === 2 &&
        rows.filter((row) => row.type === 'assistant-said').length === 2,
      timeoutMs: 90_000,
    })
    const types = typesOf(events)
    const notices = events.filter((row) => row.type === 'sandbox-setup-reported')
    expect(notices[0]?.event).toMatchObject({ phase: 'started', failed: false })
    expect(notices[1]?.event).toMatchObject({ phase: 'finished', failed: false })
    expect(types.indexOf('sandbox-setup-reported')).toBeLessThan(
      types.indexOf('workspace-prepared'),
    )
    expect(types.indexOf('workspace-prepared')).toBeLessThan(types.indexOf('user-said'))

    const startedSeq = notices[0]?.seq ?? 0
    const finishedSeq = notices[1]?.seq ?? 0
    const answers = events.filter((row) => row.type === 'assistant-said')
    expect(answers[0]?.seq).toBeGreaterThan(startedSeq)
    expect(answers[0]?.seq).toBeLessThan(finishedSeq)
    expect(answers[1]?.seq).toBeGreaterThan(finishedSeq)
    expect(existsSync(join(launchDirectory, 'prepared.txt'))).toBe(true)
    holder.discard()
  }, 90_000)

  it('tells the model when the background setup script failed, and answers again', async () => {
    const sessionId = 'prepare-e2e-2'
    const mainThreadId = await newSession({ sessionId, text: 'first' })
    const root = mkdtempSync(join(tmpdir(), 'atlas-prepare-e2e-'))
    const holder = makeHolder({
      presence: makePresence({ url: testDb().url, label: 'host-b' }),
      plane,
      bus,
      sandbox,
      scripts: { [sessionId]: [{ text: 'recovered' }, { text: 'noted the failure' }] },
      setupScript: 'sleep 3 && echo missing-marker >&2; exit 1',
      launchDirectory: join(root, 'workspace'),
    })
    await holder.start()
    await bus.wake(sessionId)

    const events = await waitForSeq({
      plane,
      threadId: mainThreadId,
      want: (rows) =>
        rows.filter((row) => row.type === 'sandbox-setup-reported').length === 2 &&
        rows.filter((row) => row.type === 'assistant-said').length === 2,
      timeoutMs: 90_000,
    })
    const types = typesOf(events)
    expect(types).not.toContain('workspace-prepare-failed')
    const notices = events.filter((row) => row.type === 'sandbox-setup-reported')
    expect(notices[1]?.event).toMatchObject({ phase: 'finished', failed: true })
    expect(String((notices[1]?.event as { text?: string } | undefined)?.text)).toContain(
      'missing-marker',
    )
    const prepared = events.find((row) => row.type === 'workspace-prepared')
    expect(prepared).toBeDefined()
    expect((prepared?.event as { warnings?: unknown } | undefined)?.warnings).toBeUndefined()
    expect(types.indexOf('workspace-prepared')).toBeLessThan(types.indexOf('user-said'))
    expect(types.filter((type) => type === 'user-said')).toHaveLength(1)
    const answers = events.filter((row) => row.type === 'assistant-said')
    expect(answers[0]?.seq).toBeLessThan(notices[1]?.seq ?? 0)
    expect(answers[1]?.seq).toBeGreaterThan(notices[1]?.seq ?? 0)
    holder.discard()
  }, 90_000)

  it('still blocks and records a failure when the sandbox cannot be created', async () => {
    const sessionId = 'prepare-e2e-3'
    const mainThreadId = await newSession({ sessionId, text: 'first' })
    const broken = new (class extends LocalSandboxProvider {
      override async wake(): Promise<never> {
        throw new Error('sandbox-create-marker')
      }
    })({ daemonSecret: E2E_SECRET })
    const holder = makeHolder({
      presence: makePresence({ url: testDb().url, label: 'host-c' }),
      plane,
      bus,
      sandbox: broken,
      scripts: { [sessionId]: [{ text: 'never' }] },
      launchDirectory: join(mkdtempSync(join(tmpdir(), 'atlas-prepare-e2e-')), 'workspace'),
    })
    await holder.start()
    await bus.wake(sessionId)

    const events = await waitForSeq({
      plane,
      threadId: mainThreadId,
      want: (rows) => rows.some((row) => row.type === 'workspace-prepare-failed'),
      timeoutMs: 30_000,
    })
    const types = typesOf(events)
    expect(types).not.toContain('workspace-prepared')
    expect(types).not.toContain('user-said')
    holder.discard()
  }, 60_000)
})
