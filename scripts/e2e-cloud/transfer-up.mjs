import { API, fail, log, signUp, userSaid } from './lib/setup.mjs'

const { token } = await signUp()
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
const threadId = `brn_e2e-transfer-${Date.now()}`

const open = (runId, drafts) =>
  fetch(`${API}/v1/threads/open`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      runId,
      threadId,
      workspace: '/w',
      executionLocation: 'cloud',
      drafts,
    }),
  })

const original = [
  userSaid('hello'),
  {
    type: 'context-loaded',
    body: JSON.stringify({
      type: 'context-loaded',
      slot: 'session',
      key: 'execution-location',
      content: 'moved',
    }),
    contextSlot: 'session',
    contextKey: 'execution-location',
    contextDigest: 'abc123',
  },
  {
    type: 'assistant-said',
    body: JSON.stringify({ type: 'assistant-said', parts: [{ type: 'text', text: 'hi there' }] }),
  },
]

const first = await open('run_e2e-1', original)
if (first.status !== 201) fail(`first open answered ${first.status}`)
log('thread transferred up')

const retry = await open('run_e2e-1', original)
if (retry.status !== 201) fail(`retry open answered ${retry.status} — the transfer is not idempotent`)
log('transfer retry replays idempotently')

const withMore = await open('run_e2e-2', [...original, userSaid('one more')])
if (withMore.status !== 201) fail(`open with a novel draft answered ${withMore.status}`)
log('a replay carrying new events appends only the novel tail')

const diverged = await open('run_e2e-3', [userSaid('edited!'), ...original.slice(1)])
if (diverged.status !== 409) fail(`diverged replay answered ${diverged.status}, want 409`)
log('a diverged replay is refused, not clobbered')

const shorter = await open('run_e2e-4', original.slice(0, 1))
if (shorter.status !== 409) fail(`shorter replay answered ${shorter.status}, want 409`)
log('a shorter replay is refused, not truncated')

const events = await fetch(`${API}/v1/threads/${threadId}/events`, { headers })
const rows = await events.json()
const seqs = rows.map((event) => event.seq)
if (seqs.join(',') !== '1,2,3,4') fail(`log reads back as seqs ${seqs.join(',')}`)
log('the log reads back exactly once per event')

console.log('TRANSFER-UP PHASE GREEN')
