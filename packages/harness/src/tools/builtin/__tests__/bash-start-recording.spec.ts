import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { RecordingLog } from '../../../shells/__tests__/shell-registry-log'
import { discardSuites, openRuntimeRegistry, type RuntimeSuite } from './runtime-launcher'

let root = ''
const suites: RuntimeSuite[] = []

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'atlas-bash-record-'))
})

afterAll(async () => {
  await discardSuites(suites)
  await rm(root, { recursive: true, force: true })
})

const THREAD = toThreadId('thread-1')

describe('BunShellRegistry start recording', () => {
  it('appends a durable background-shell-started the moment a background shell is tracked', async () => {
    const suite = await openRuntimeRegistry({ root, withLog: true })
    suites.push(suite)

    const started = await suite.shells.start({
      threadId: THREAD,
      command: 'sleep 30',
      description: 'record me',
    })

    if (!started.ok) throw new Error(started.reason ?? 'expected the shell to start')

    for (let attempt = 0; attempt < 200 && !suite.log?.appended.some(isStarted); attempt += 1) {
      await Bun.sleep(10)
    }

    const recorded = suite.log?.appended.find(isStarted)
    expect(recorded).toBeDefined()
    if (recorded?.type !== 'background-shell-started') throw new Error('expected a start record')
    expect(recorded.command).toBe('sleep 30')
    expect(recorded.description).toBe('record me')
    expect(recorded.shellId).toBe(started.snapshot.shellId)
  }, 30_000)

  it('still starts the shell when no log is wired in', async () => {
    const suite = await openRuntimeRegistry({ root })
    suites.push(suite)

    const started = await suite.shells.start({
      threadId: THREAD,
      command: 'sleep 30',
      description: 'no log',
    })

    expect(started.ok).toBe(true)
  }, 30_000)
})

type StartedDraft = { type: string }
const isStarted = (draft: StartedDraft): boolean => draft.type === 'background-shell-started'
