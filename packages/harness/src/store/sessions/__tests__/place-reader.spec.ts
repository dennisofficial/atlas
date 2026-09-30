import { afterEach, describe, expect, it } from 'bun:test'
import { appendFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId, type EventDraft, type LinkedPullRequest } from '@dltech/atlas-core'

import { CountingIds, SteppingClock } from '../../__tests__/harness'
import { JsonlEventLog } from '../event-log'
import { eventLogFile, sessionDirectory } from '../paths'
import { SessionRegistry } from '../registry'
import { placesForSegments, type PlaceSegment } from '../session-place-reader'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-place-reader-'))
  directories.push(dir)
  return dir
}

const said = (text: string): EventDraft => ({ type: 'user-said', text })
const entered = (path: string, branch: string): EventDraft => ({ type: 'worktree-entered', path, branch })
const linked = (pr: LinkedPullRequest): EventDraft => ({ type: 'pull-request-linked', ...pr })

function openLog({ home }: { home: string }): { log: JsonlEventLog; ids: CountingIds } {
  const registry = new SessionRegistry(home)
  const ids = new CountingIds('spec')
  return { log: new JsonlEventLog(home, registry, new SteppingClock(), ids), ids }
}

function segmentOf({ home, threadId, upTo }: { home: string; threadId: string; upTo?: number }): PlaceSegment {
  return {
    threadId: toThreadId(threadId),
    sessionDir: sessionDirectory({ home, sessionId: toThreadId(threadId) }),
    upTo,
  }
}

describe('the encoded event line the reader depends on', () => {
  it('places the type ahead of the body, so a listing scan can decide a line from its prefix', async () => {
    const home = await tempHome()
    const { log, ids } = openLog({ home })
    const threadId = toThreadId('spec-thread-encoding')
    await log.append({ threadId, runId: ids.nextRunId(), drafts: [entered('/work/.wt/order', 'dennis/order')] })

    const file = eventLogFile({ sessionDir: sessionDirectory({ home, sessionId: threadId }), threadId })
    const line = (await readFile(file, 'utf8')).split('\n')[0] ?? ''
    expect(line.indexOf('"type"')).toBeLessThan(line.indexOf('"body"'))
  })
})

describe('the bounded place reader', () => {
  it('reads only the place events, even when one irrelevant line dwarfs the whole log', async () => {
    const home = await tempHome()
    const { log, ids } = openLog({ home })
    const threadId = toThreadId('spec-thread-giant-line')
    await log.append({ threadId, runId: ids.nextRunId(), drafts: [entered('/work/.wt/first', 'dennis/first')] })
    await log.append({
      threadId,
      runId: ids.nextRunId(),
      drafts: [{ type: 'assistant-said', parts: [{ type: 'text', text: 'z'.repeat(5_000_000) }] }],
    })

    const places = await placesForSegments({ segments: [segmentOf({ home, threadId })] })
    expect(places.worktree).toEqual({ path: '/work/.wt/first', branch: 'dennis/first' })
  })

  it('sees an external append between two reads of the same file', async () => {
    const home = await tempHome()
    const { log, ids } = openLog({ home })
    const threadId = toThreadId('spec-thread-external')
    await log.append({ threadId, runId: ids.nextRunId(), drafts: [entered('/work/.wt/one', 'dennis/one')] })
    const first = await placesForSegments({ segments: [segmentOf({ home, threadId })] })
    expect(first.worktree?.branch).toBe('dennis/one')

    const file = eventLogFile({ sessionDir: sessionDirectory({ home, sessionId: threadId }), threadId })
    const before = await stat(file)
    const line = JSON.stringify({
      v: 1,
      id: 'spec-event-external',
      seq: 2,
      threadId,
      runId: 'spec-run-external',
      depth: 0,
      at: '2026-01-01T00:00:00.000Z',
      type: 'worktree-entered',
      body: { type: 'worktree-entered', path: '/work/.wt/two', branch: 'dennis/two' },
    })
    await appendFile(file, `${line}\n`, 'utf8')
    const after = await stat(file)
    expect(after.size).toBeGreaterThan(before.size)

    const second = await placesForSegments({ segments: [segmentOf({ home, threadId })] })
    expect(second.worktree?.branch).toBe('dennis/two')
  })

  it('sees an external rewrite that replaced the file outright', async () => {
    const home = await tempHome()
    const { log, ids } = openLog({ home })
    const threadId = toThreadId('spec-thread-replaced')
    await log.append({ threadId, runId: ids.nextRunId(), drafts: [entered('/work/.wt/one', 'dennis/one')] })
    expect((await placesForSegments({ segments: [segmentOf({ home, threadId })] })).worktree?.branch).toBe('dennis/one')

    const file = eventLogFile({ sessionDir: sessionDirectory({ home, sessionId: threadId }), threadId })
    const replacement = JSON.stringify({
      v: 1,
      id: 'spec-event-replacement',
      seq: 1,
      threadId,
      runId: 'spec-run-replacement',
      depth: 0,
      at: '2026-01-01T00:00:00.000Z',
      type: 'worktree-entered',
      body: { type: 'worktree-entered', path: '/work/.wt/replaced', branch: 'dennis/replaced' },
    })
    await writeFile(file, `${replacement}\n`, 'utf8')

    expect((await placesForSegments({ segments: [segmentOf({ home, threadId })] })).worktree?.branch).toBe(
      'dennis/replaced',
    )
  })

  it('reads a line whose type key carries whitespace, as legacy JSON pretty-printing wrote it', async () => {
    const home = await tempHome()
    const threadId = toThreadId('spec-thread-whitespace')
    const file = eventLogFile({ sessionDir: sessionDirectory({ home, sessionId: threadId }), threadId })
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(
      file,
      `${JSON.stringify({ v: 1, id: 'e1', seq: 1, threadId, runId: 'r1', depth: 0, at: '2026-01-01T00:00:00.000Z', type: 'user-said', body: { type: 'user-said', text: 'hi' } })}\n`,
      'utf8',
    )
    const spaced =
      '{ "v":1, "id":"e2", "seq":2, "threadId":"spec-thread-whitespace", "runId":"r2", "depth":0, "at":"2026-01-01T00:00:01.000Z", "type": "worktree-entered", "body":{ "type":"worktree-entered", "path":"/work/.wt/spaced", "branch":"dennis/spaced" } }'
    await appendFile(file, `${spaced}\n`, 'utf8')

    const places = await placesForSegments({ segments: [segmentOf({ home, threadId })] })
    expect(places.worktree).toEqual({ path: '/work/.wt/spaced', branch: 'dennis/spaced' })
  })

  it('reassembles a multi-byte path split across a read block boundary', async () => {
    const home = await tempHome()
    const threadId = toThreadId('spec-thread-utf8')
    const file = eventLogFile({ sessionDir: sessionDirectory({ home, sessionId: threadId }), threadId })
    await mkdir(join(file, '..'), { recursive: true })
    const filler = JSON.stringify({
      v: 1,
      id: 'e0',
      seq: 1,
      threadId,
      runId: 'r0',
      depth: 0,
      at: '2026-01-01T00:00:00.000Z',
      type: 'user-said',
      body: { type: 'user-said', text: 'f'.repeat(65_520) },
    })
    const line = JSON.stringify({
      v: 1,
      id: 'e1',
      seq: 2,
      threadId,
      runId: 'r1',
      depth: 0,
      at: '2026-01-01T00:00:01.000Z',
      type: 'worktree-entered',
      body: { type: 'worktree-entered', path: '/work/.wt/日本語のブランチ', branch: 'dennis/日本語' },
    })
    await writeFile(file, `${filler}\n${line}\n`, 'utf8')

    const places = await placesForSegments({ segments: [segmentOf({ home, threadId })] })
    expect(places.worktree?.path).toBe('/work/.wt/日本語のブランチ')
  })

  it('ignores a torn tail left by a crashed write', async () => {
    const home = await tempHome()
    const { log, ids } = openLog({ home })
    const threadId = toThreadId('spec-thread-torn')
    await log.append({ threadId, runId: ids.nextRunId(), drafts: [entered('/work/.wt/whole', 'dennis/whole')] })
    const file = eventLogFile({ sessionDir: sessionDirectory({ home, sessionId: threadId }), threadId })
    await appendFile(file, '{"v":1,"type":"worktree-entered","body":{"path":"/never', 'utf8')

    const places = await placesForSegments({ segments: [segmentOf({ home, threadId })] })
    expect(places.worktree?.branch).toBe('dennis/whole')
  })

  it('honours the segment cutoff for a reference fork', async () => {
    const home = await tempHome()
    const { log, ids } = openLog({ home })
    const threadId = toThreadId('spec-thread-cutoff')
    await log.append({
      threadId,
      runId: ids.nextRunId(),
      drafts: [
        said('first'),
        entered('/work/.wt/before-fork', 'dennis/before-fork'),
        linked({ number: 401, url: 'https://github.com/acme/app/pull/401', repo: 'github.com/acme/app', branch: 'dennis/a' }),
        entered('/work/.wt/after-fork', 'dennis/after-fork'),
      ],
    })

    const before = await placesForSegments({ segments: [segmentOf({ home, threadId, upTo: 2 })] })
    expect(before.worktree?.branch).toBe('dennis/before-fork')
    expect(before.pullRequests).toEqual([])

    const after = await placesForSegments({ segments: [segmentOf({ home, threadId })] })
    expect(after.worktree?.branch).toBe('dennis/after-fork')
    expect(after.pullRequests.map((pr) => pr.number)).toEqual([401])
  })
})
