import { atlasDirectory } from '../src/store/paths'
import { JsonlEventLog } from '../src/store/sessions/event-log'
import { SessionRegistry } from '../src/store/sessions/registry'
import { JsonlThreadStore } from '../src/store/sessions/thread-store'
import { RandomIds, SystemClock } from '../src/store'

const home = atlasDirectory()
const registry = new SessionRegistry(home)
const clock = new SystemClock()
const ids = new RandomIds()
const log = new JsonlEventLog(home, registry, clock, ids)
const threads = new JsonlThreadStore(home, registry, clock, ids, log)

const project = process.argv[2] ?? '/Users/dennislysenko/Developer/atlas'
const recent = await threads.mostRecent({ project })
if (recent === undefined) throw new Error(`no recent thread for ${project}`)
console.log(`most recent: "${recent.title}" (${recent.id}) head=${recent.head} updated=${recent.updatedAt}`)

const listed = await threads.list({ project, limit: 5 })
console.log(`listed ${listed.length} sessions for the project`)
for (const entry of listed) console.log(`  - "${entry.title}" ${entry.updatedAt}`)

const events = await log.read({ threadId: recent.id })
console.log(`composed read of most recent: ${events.length} events`)
console.log('REAL HOME VERIFY OK')
