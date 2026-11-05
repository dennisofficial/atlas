import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeEach, describe, expect, it } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
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
      payload: JSON.stringify({ text: args.text }),
    })
    return mainThreadId
  }

  it('runs the setup script and records workspace-prepared before the first user-said', async () => {
    const sessionId = 'prepare-e2e-1'
    const mainThreadId = await newSession({ sessionId, text: 'hello' })
    const launchDirectory = join(mkdtempSync(join(tmpdir(), 'atlas-prepare-e2e-')), 'workspace')
    const holder = makeHolder({
      presence: makePresence({ url: testDb().url, label: 'host-a' }),
      plane,
      bus,
      sandbox,
      scripts: { [sessionId]: [{ text: 'hi there' }] },
      setupScript: 'echo ready > prepared.txt',
      launchDirectory,
    })
    await holder.start()
    await bus.wake(sessionId)

    const events = await waitForSeq({
      plane,
      threadId: mainThreadId,
      want: (rows) => rows.some((row) => row.type === 'assistant-said'),
      timeoutMs: 60_000,
    })
    const types = typesOf(events)
    expect(types.indexOf('workspace-prepared')).toBe(0)
    expect(types.indexOf('workspace-prepared')).toBeLessThan(types.indexOf('user-said'))
    expect(existsSync(join(launchDirectory, 'prepared.txt'))).toBe(true)
    holder.discard()
  }, 90_000)

  it('records a failed setup without a turn, then retries on the next message', async () => {
    const sessionId = 'prepare-e2e-2'
    const mainThreadId = await newSession({ sessionId, text: 'first' })
    const root = mkdtempSync(join(tmpdir(), 'atlas-prepare-e2e-'))
    const marker = join(root, 'fixed')
    const holder = makeHolder({
      presence: makePresence({ url: testDb().url, label: 'host-b' }),
      plane,
      bus,
      sandbox,
      scripts: { [sessionId]: [{ text: 'recovered' }] },
      setupScript: `test -f ${marker} || { echo missing-marker >&2; exit 1; }`,
      launchDirectory: join(root, 'workspace'),
    })
    await holder.start()
    await bus.wake(sessionId)

    const failed = await waitForSeq({
      plane,
      threadId: mainThreadId,
      want: (rows) => rows.some((row) => row.type === 'workspace-prepare-failed'),
      timeoutMs: 60_000,
    })
    const failure = failed.find((row) => row.type === 'workspace-prepare-failed')
    expect(failure).toBeDefined()
    expect(String((failure?.event as { reason?: string } | undefined)?.reason)).toContain(
      'missing-marker',
    )
    expect(typesOf(failed)).not.toContain('user-said')

    writeFileSync(marker, 'ok')
    await plane.post({
      sessionId,
      kind: INBOX_KIND_MESSAGE,
      payload: JSON.stringify({ text: 'second' }),
    })
    await bus.wake(sessionId)

    const events = await waitForSeq({
      plane,
      threadId: mainThreadId,
      want: (rows) => rows.some((row) => row.type === 'assistant-said'),
      timeoutMs: 60_000,
    })
    const types = typesOf(events)
    expect(types.indexOf('workspace-prepare-failed')).toBeLessThan(
      types.indexOf('workspace-prepared'),
    )
    expect(types.indexOf('workspace-prepared')).toBeLessThan(types.indexOf('user-said'))
    holder.discard()
  }, 90_000)
})
