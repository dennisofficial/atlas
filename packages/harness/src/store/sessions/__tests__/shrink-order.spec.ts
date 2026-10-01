import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { toThreadId } from '@dltech/atlas-core'
import { CountingIds, SteppingClock } from '../../__tests__/harness'
import { JsonlEventLog } from '../event-log'
import { parseEventLines } from '../lines'
import { readMetaSync, threadMetaSchema } from '../meta'
import { truncateThreadLog } from '../ops/log-edits'
import { eventLogFile, sessionDirectory, threadMetaFile } from '../paths'
import { SessionRegistry } from '../registry'

const homes: string[] = []
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

const threadId = toThreadId('brn_shrink')
const seeded = async () => {
  const home = await mkdtemp(join(tmpdir(), 'atlas-shrink-order-'))
  homes.push(home)
  const registry = new SessionRegistry(home)
  const ids = new CountingIds('shrink')
  const clock = new SteppingClock()
  const log = new JsonlEventLog(home, registry, clock, ids)
  await log.append({
    threadId,
    runId: ids.nextRunId(),
    drafts: ['one', 'two', 'three'].map((text) => ({ type: 'user-said', text })),
  })
  const sessionDir = sessionDirectory({ home, sessionId: threadId })
  const stamp = registry.stampThreadLog.bind(registry)
  registry.stampThreadLog = async (request) => {
    const meta = readMetaSync({
      file: threadMetaFile({ sessionDir, threadId }),
      schema: threadMetaSchema,
    })
    const text = await readFile(eventLogFile({ sessionDir, threadId }), 'utf8')
    expect(meta?.head).toBeLessThanOrEqual(parseEventLines({ text, threadId }).head)
    await stamp(request)
  }
  return { home, sessionDir, registry, ids, clock, log }
}

describe('publishing a shorter durable log', () => {
  it('writes the smaller metadata head before publishing replacement events', async () => {
    const { log, ids } = await seeded()
    await log.replace({
      threadId,
      runId: ids.nextRunId(),
      drafts: [{ type: 'user-said', text: 'summary' }],
    })
    expect(await log.head({ threadId })).toBe(1)
  })

  it('writes the smaller metadata head before publishing a truncated log', async () => {
    const { log, registry, clock, sessionDir } = await seeded()
    await truncateThreadLog({ registry, clock, sessionDir, threadId, toSeq: 1 })
    expect(await log.head({ threadId })).toBe(1)
  })
})
