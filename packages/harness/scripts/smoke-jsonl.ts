import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { EForkMode, toThreadId, type ThreadId } from '@dltech/atlas-core'

import { JsonlTurnLedger, sumSessionSpend } from '../src/ledger/jsonl'
import { JsonlEventLog } from '../src/store/sessions/event-log'
import { readMetaSync, readSessionMetaSync, sessionMetaSchema, threadMetaSchema } from '../src/store/sessions/meta'
import { eventLogFile, sessionMetaFile, sessionsDirectory, threadMetaFile } from '../src/store/sessions/paths'
import { SessionRegistry } from '../src/store/sessions/registry'
import { JsonlThreadStore } from '../src/store/sessions/thread-store'
import { CountingIds, SteppingClock } from '../src/store/__tests__/harness'

const home = '/tmp/jsonl-smoke-home'
const registry = new SessionRegistry(home)
const clock = new SteppingClock()
const ids = new CountingIds('smoke')
const log = new JsonlEventLog(home, registry, clock, ids)

const root = sessionsDirectory({ home })
const sessions = readdirSync(root)
console.log(`sessions on disk: ${sessions.length}`)

const metas = sessions
  .map((dir) => {
    const sessionDir = join(root, dir)
    const meta = readSessionMetaSync({ file: sessionMetaFile({ sessionDir }), sessionDir })
    if (meta === undefined) return undefined
    const file = eventLogFile({ sessionDir, threadId: toThreadId(meta.id) })
    return { meta, bytes: readFileSync(file, 'utf8').length }
  })
  .filter((entry) => entry !== undefined)
  .sort((a, b) => b.bytes - a.bytes)

const biggest = metas[0]
if (biggest === undefined) throw new Error('no sessions')
console.log(`biggest session: ${biggest.meta.id} "${biggest.meta.title}" (${(biggest.bytes / 1048576).toFixed(1)} MB)`)

const threadId = toThreadId(biggest.meta.id)
const start = performance.now()
const events = await log.read({ threadId })
const ms = performance.now() - start
console.log(`read ${events.length} events in ${ms.toFixed(0)}ms; head=${await log.head({ threadId })}`)

const meta = readMetaSync({
  file: threadMetaFile({ sessionDir: join(root, biggest.meta.id), threadId }),
  schema: threadMetaSchema,
})
console.log(`thread meta head: ${meta?.head}, matches log head: ${meta?.head === (await log.head({ threadId }))}`)

const threads = new JsonlThreadStore(home, registry, clock, ids, log)
const forkSeq = Math.max(1, Math.floor(events.length / 2))
const forked = await threads.fork({ from: threadId, seq: forkSeq, mode: EForkMode.Reference, title: 'smoke fork' })
const stamped = await log.append({
  threadId: forked.id,
  runId: ids.nextRunId(),
  drafts: [{ type: 'nudge', text: 'smoke append', lifetimeSteps: 1 }],
})
const composed = await log.read({ threadId: forked.id })
console.log(
  `fork at seq ${forkSeq}: own event seq ${stamped[0]?.seq} (want ${forkSeq + 1}); composed ${composed.length} events (want ${forkSeq + 1}); last type ${composed[composed.length - 1]?.type}`,
)

const spend = await sumSessionSpend({ sessionDir: join(root, biggest.meta.id) })
console.log(`biggest session spend: ${spend.inputTokens} in / ${spend.outputTokens} out / ${spend.cacheReadTokens} cache-read`)

const ledger = new JsonlTurnLedger({ home, registry })
const turns = await ledger.forThread({ threadId })
console.log(`ledger turns for biggest root: ${turns.length}`)
console.log('SMOKE OK')
