import { API, fail, log, signUp, userSaid } from './lib/setup.mjs'

const { token } = await signUp()
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
const threadId = `brn_e2e-down-${Date.now()}`

const opened = await fetch(`${API}/v1/threads/open`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    runId: 'run_e2e-down-1',
    threadId,
    workspace: '/w',
    executionLocation: 'cloud',
    drafts: [userSaid('up in the cloud')],
  }),
})
if (opened.status !== 201) fail(`open answered ${opened.status}`)
log('thread opened in the cloud')

const flipped = await fetch(`${API}/v1/threads/${threadId}/location`, {
  method: 'PATCH',
  headers,
  body: JSON.stringify({ location: 'host' }),
})
if (flipped.status !== 200 && flipped.status !== 204) {
  fail(`location flip answered ${flipped.status}: ${await flipped.text()}`)
}
log('location flipped to host')

const readBack = await fetch(`${API}/v1/threads/${threadId}`, { headers })
const row = await readBack.json()
if (row.executionLocation !== 'host') fail(`readback says ${row.executionLocation}`)
log('readback confirms host')

const events = await fetch(`${API}/v1/threads/${threadId}/events`, { headers })
const rows = await events.json()
if (!Array.isArray(rows) || rows.length !== 1 || rows[0].type !== 'user-said') {
  fail(`log after the flip: ${JSON.stringify(rows).slice(0, 140)}`)
}
log('log survives the flip')

const liftedAgain = await fetch(`${API}/v1/threads/open`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    runId: 'run_e2e-down-2',
    threadId,
    workspace: '/w',
    executionLocation: 'cloud',
    drafts: [userSaid('up in the cloud'), userSaid('back up again')],
  }),
})
if (liftedAgain.status !== 201) fail(`re-lift answered ${liftedAgain.status}`)
const liftedRow = await liftedAgain.json()
if (liftedRow.thread.executionLocation !== 'cloud') {
  fail(`re-lift left the location ${liftedRow.thread.executionLocation}`)
}
log('re-lift takes the thread back up, novel draft appended')

const after = await fetch(`${API}/v1/threads/${threadId}/events`, { headers })
const afterRows = await after.json()
if (afterRows.length !== 2) fail(`log after re-lift holds ${afterRows.length} events, want 2`)

console.log('TRANSFER-DOWN PHASE GREEN')
