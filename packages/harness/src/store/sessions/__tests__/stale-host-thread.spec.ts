import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EExecutionLocation, toRunId } from '@dltech/atlas-core'

import { CountingIds, SteppingClock } from '../../__tests__/harness'
import { JsonlEventLog } from '../event-log'
import { readMetaSync, threadMetaSchema } from '../meta'
import { eventLogFile, sessionDirectory, threadMetaFile } from '../paths'
import { SessionRegistry } from '../registry'
import { JsonlThreadStore } from '../thread-store'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const open = (home: string) => {
  const registry = new SessionRegistry(home)
  const clock = new SteppingClock()
  const ids = new CountingIds('stale')
  const log = new JsonlEventLog(home, registry, clock, ids)
  return { log, threads: new JsonlThreadStore(home, registry, clock, ids, log) }
}

describe('a cloud thread that was once host-placed', () => {
  it('still lists and reads when its log and meta carry persisted values this build does not know', async () => {
    const home = await mkdtemp(join(tmpdir(), 'atlas-stale-host-'))
    directories.push(home)
    const first = open(home)
    const { thread } = await first.threads.createWithFirstEvents({
      runId: toRunId('run_stale'),
      workspace: '/work',
      executionLocation: EExecutionLocation.Cloud,
      drafts: [
        { type: 'user-said', text: 'hello' },
        { type: 'location-changed', to: EExecutionLocation.Cloud, cwd: '/work' },
      ],
    })
    const sessionDir = sessionDirectory({ home, sessionId: thread.id })

    const logFile = eventLogFile({ sessionDir, threadId: thread.id })
    const lines = (await readFile(logFile, 'utf8')).trimEnd().split('\n')
    const stale = lines.map((line) =>
      line.includes('"location-changed"')
        ? line.replace(/"to":"cloud"/, '"from":"docker","to":"host"')
        : line,
    )
    expect(stale.join('\n')).toContain('"to":"host"')
    await writeFile(logFile, `${stale.join('\n')}\n`)

    const metaFile = threadMetaFile({ sessionDir, threadId: thread.id })
    const meta = JSON.parse(await readFile(metaFile, 'utf8')) as Record<string, unknown>
    await writeFile(
      metaFile,
      JSON.stringify({ ...meta, placement: { placement: { harness: 'host', tools: 'docker' }, revision: 2 } }),
    )
    expect(readMetaSync({ file: metaFile, schema: threadMetaSchema })).toBeDefined()

    const reopened = open(home)
    const listed = await reopened.threads.list({ project: '/work' })
    expect(listed.map((row) => row.id)).toEqual([thread.id])
    expect(await reopened.threads.mostRecent({ project: '/work' })).toMatchObject({ id: thread.id })

    const events = await reopened.log.read({ threadId: thread.id })
    expect(events.map((event) => event.type)).toEqual(['user-said', 'location-changed'])
    expect(events[1]).toMatchObject({ type: 'location-changed', cwd: '/work' })
    expect((events[1] as { to?: unknown }).to).toBeUndefined()
  })

  it('hides a thread whose meta points anywhere but the cloud', async () => {
    const home = await mkdtemp(join(tmpdir(), 'atlas-hidden-host-'))
    directories.push(home)
    const store = open(home)
    await store.threads.createWithFirstEvents({
      runId: toRunId('run_hidden'),
      workspace: '/work',
      drafts: [{ type: 'user-said', text: 'old host thread' }],
    })

    expect(await store.threads.list({ project: '/work' })).toEqual([])
    expect(await store.threads.mostRecent({ project: '/work' })).toBeUndefined()
  })
})
