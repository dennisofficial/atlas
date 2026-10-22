import { afterEach, describe, expect, it } from 'bun:test'
import { appendFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId, type EventDraft, type ThreadId } from '@dltech/atlas-core'

import { CountingIds, SteppingClock } from '../../../__tests__/harness'
import { appendDrafts } from '../log-edits'
import { eventLogFile, sessionDirectory } from '../../paths'
import { SessionRegistry } from '../../registry'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const threadId: ThreadId = toThreadId('brn_ops')

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-log-edits-'))
  directories.push(dir)
  return dir
}

function nudge({ text }: { text: string }): EventDraft {
  return { type: 'nudge', text, lifetimeSteps: 1 }
}

function openOps({ home }: { home: string }): { registry: SessionRegistry; clock: SteppingClock; ids: CountingIds } {
  return { registry: new SessionRegistry(home), clock: new SteppingClock(), ids: new CountingIds('spec') }
}

describe('appendDrafts', () => {
  it('welds a torn tail away before appending, so the next batch starts on its own line', async () => {
    const home = await tempHome()
    const ops = openOps({ home })
    const sessionDir = sessionDirectory({ home, sessionId: threadId })

    await appendDrafts({
      registry: ops.registry,
      clock: ops.clock,
      ids: ops.ids,
      sessionDir,
      threadId,
      runId: ops.ids.nextRunId(),
      drafts: [nudge({ text: 'one' })],
    })

    const file = eventLogFile({ sessionDir, threadId })
    appendFileSync(file, '{"v":1,"id":"evt_tail","seq":2,"th')

    const stamped = await appendDrafts({
      registry: ops.registry,
      clock: ops.clock,
      ids: ops.ids,
      sessionDir,
      threadId,
      runId: ops.ids.nextRunId(),
      drafts: [nudge({ text: 'two' })],
    })

    expect(stamped.map((event) => event.seq)).toEqual([2])
    const reopened = new SessionRegistry(home)
    const log = await reopened.readThreadLog({ sessionDir, threadId })
    expect(log.events.map((event) => (event.type === 'nudge' ? event.text : event.type))).toEqual(['one', 'two'])
  })

  it('re-reads the log when another writer touched it, instead of reusing a stale head', async () => {
    const home = await tempHome()
    const first = openOps({ home })
    const sessionDir = sessionDirectory({ home, sessionId: threadId })

    await appendDrafts({
      registry: first.registry,
      clock: first.clock,
      ids: first.ids,
      sessionDir,
      threadId,
      runId: first.ids.nextRunId(),
      drafts: [nudge({ text: 'one' })],
    })

    const outsider = openOps({ home })
    await appendDrafts({
      registry: outsider.registry,
      clock: outsider.clock,
      ids: outsider.ids,
      sessionDir,
      threadId,
      runId: outsider.ids.nextRunId(),
      drafts: [nudge({ text: 'outside' })],
    })

    const stamped = await appendDrafts({
      registry: first.registry,
      clock: first.clock,
      ids: first.ids,
      sessionDir,
      threadId,
      runId: first.ids.nextRunId(),
      drafts: [nudge({ text: 'two' })],
    })

    expect(stamped.map((event) => event.seq)).toEqual([3])
    const reopened = new SessionRegistry(home)
    const log = await reopened.readThreadLog({ sessionDir, threadId })
    expect(log.events.map((event) => (event.type === 'nudge' ? event.text : event.type))).toEqual(['one', 'outside', 'two'])
  })
})
