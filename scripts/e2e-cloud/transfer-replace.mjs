import { API, fail, log, signUp, userSaid } from './lib/setup.mjs'

const { token } = await signUp()
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
const threadId = `brn_e2e-replace-${Date.now()}`

const opened = await fetch(`${API}/v1/threads/open`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    runId: 'run_e2e-replace-1',
    threadId,
    workspace: '/w',
    executionLocation: 'cloud',
    drafts: [userSaid('cloud one'), userSaid('cloud two')],
  }),
})
if (opened.status !== 201) fail(`open answered ${opened.status}`)
log('thread opened in the cloud with two events')

const replaced = await fetch(`${API}/v1/threads/${threadId}/events`, {
  method: 'PUT',
  headers,
  body: JSON.stringify({
    runId: 'run_e2e-replace-2',
    drafts: [
      userSaid('local one'),
      userSaid('local two'),
      {
        type: 'context-loaded',
        body: JSON.stringify({
          type: 'context-loaded',
          slot: 'memory',
          key: 'MEMORY.md',
          content: '# remembered',
        }),
        contextSlot: 'memory',
        contextKey: 'MEMORY.md',
        contextDigest: 'digest-1',
      },
    ],
  }),
})
if (replaced.status !== 200 && replaced.status !== 201) {
  fail(`replace answered ${replaced.status}: ${await replaced.text()}`)
}
const stamped = await replaced.json()
if (!Array.isArray(stamped) || stamped.length !== 3) {
  fail(`replace returned ${JSON.stringify(stamped).slice(0, 140)}`)
}
if (stamped.map((row) => row.seq).join(',') !== '1,2,3') {
  fail(`replace re-seqs from one, got ${stamped.map((row) => row.seq).join(',')}`)
}
log('replace re-stamps the log from seq 1')

const readBack = await fetch(`${API}/v1/threads/${threadId}/events`, { headers })
const rows = await readBack.json()
const texts = rows.map((row) => row.type)
if (texts.join(',') !== 'user-said,user-said,context-loaded') {
  fail(`log after replace: ${texts.join(',')}`)
}
const firstBody = JSON.parse(rows[0].body)
if (firstBody.text !== 'local one') fail(`seq 1 holds ${firstBody.text}, want the local copy`)
log('the cloud log is the local one wholesale — the stale cloud events are gone')

const head = await fetch(`${API}/v1/threads/${threadId}/events/head`, { headers })
const headRow = await head.json()
if (headRow.head !== 3) fail(`head after replace is ${headRow.head}, want 3`)
log('head follows the replaced log')

const wiped = await fetch(`${API}/v1/threads/${threadId}/events`, {
  method: 'PUT',
  headers,
  body: JSON.stringify({ runId: 'run_e2e-replace-3', drafts: [] }),
})
if (wiped.status !== 200 && wiped.status !== 201) fail(`empty replace answered ${wiped.status}`)
const afterWipe = await fetch(`${API}/v1/threads/${threadId}/events`, { headers })
const wipedRows = await afterWipe.json()
if (!Array.isArray(wipedRows) || wipedRows.length !== 0) {
  fail(`empty replace left ${wipedRows.length} events`)
}
log('an empty replace empties the log')

const missing = await fetch(`${API}/v1/threads/brn_e2e-nope/events`, {
  method: 'PUT',
  headers,
  body: JSON.stringify({ runId: 'run_e2e-replace-4', drafts: [userSaid('nobody home')] }),
})
if (missing.status !== 404) fail(`replace on a missing thread answered ${missing.status}, want 404`)
log('replace refuses a thread that does not exist')

console.log('TRANSFER-REPLACE PHASE GREEN')
