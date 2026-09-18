import { createHash } from 'node:crypto'
import http from 'node:http'

import { toRunId, toThreadId, type StepSignal } from '../../packages/core/src/index'
import {
  createRemoteDeltaChannel,
  ETurnStatus,
  RemoteEventLog,
  RemoteThreadStore,
  RemoteTurnRunner,
  SessionsClient,
} from '../../packages/harness/src/index'
import { startServe, type ServeHandle } from '../../packages/harness/src/serve/index'
import { API, fail, log, MOCK_PORT, PG_CONTAINER, SERVE_PORT, signUp } from './lib/setup.mjs'

const SERVE_URL = `http://localhost:${SERVE_PORT}`
const SANDBOX_TOKEN = `e2e-sandbox-${Date.now()}`

// A canned OpenAI-compatible model: streams a fixed answer over SSE. When told to stop answering,
// it fails fast with a 400 (non-retryable), which is how the failure-surfacing leg is driven.
let mockAnswers = true
const mock = http.createServer((request, response) => {
  if (request.method === 'POST' && request.url === '/v1/chat/completions' && mockAnswers) {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write(
      'data: {"id":"chatcmpl-e2e","object":"chat.completion.chunk","created":1,"model":"mock","choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}\n\n',
    )
    response.write(
      'data: {"id":"chatcmpl-e2e","object":"chat.completion.chunk","created":1,"model":"mock","choices":[{"index":0,"delta":{"content":"Hello from the sandbox"}}]}\n\n',
    )
    response.write(
      'data: {"id":"chatcmpl-e2e","object":"chat.completion.chunk","created":1,"model":"mock","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":4,"total_tokens":16}}\n\n',
    )
    response.write('data: [DONE]\n\n')
    response.end()
    return
  }
  response.writeHead(400, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ error: { message: 'the mock model is down' } }))
})
await new Promise<void>((resolve) => mock.listen(MOCK_PORT, resolve))

const { token: userToken, userId } = await signUp()
const client = new SessionsClient({ url: API, token: userToken, clientVersion: 'e2e' })
const threads = new RemoteThreadStore({ client })
const eventLog = new RemoteEventLog({ client })

const threadId = toThreadId(`brn_e2e-serve-${Date.now()}`)
await threads.createWithFirstEvents({
  runId: toRunId('run_e2e-seed'),
  threadId,
  workspace: '/w',
  executionLocation: 'cloud',
  drafts: [{ type: 'user-said', text: 'seed' }],
})
log(`thread transferred up: ${threadId}`)

const tokenHash = createHash('sha256').update(SANDBOX_TOKEN).digest('hex')
const sql = `INSERT INTO "CloudSandbox" (id, "threadId", "userId", "sandboxId", name, region, state, "lastActivityAt", "tokenHash", "createdAt", "updatedAt") VALUES ('sbx_e2e_${Date.now()}', '${threadId}', '${userId}', 'vsbx_e2e', 'atlas-thread-e2e', 'iad1', 'running', now(), '${tokenHash}', now(), now()) ON CONFLICT ("threadId") DO UPDATE SET "tokenHash" = EXCLUDED."tokenHash", state = 'running', "lastActivityAt" = now()`
const insert = Bun.spawnSync([
  'docker',
  'exec',
  PG_CONTAINER,
  'psql',
  'postgresql://postgres:postgres@localhost:5432/postgres',
  '-c',
  sql,
])
if (insert.exitCode !== 0) fail(`sandbox row insert: ${insert.stderr.toString()}`)
log('sandbox row minted')

const serveArgs = {
  threadId,
  port: SERVE_PORT,
  token: SANDBOX_TOKEN,
  controlPlaneUrl: API,
  cwd: '/tmp/e2e-cloud-ws',
  model: 'openrouter/moonshotai/kimi-k3',
  env: {
    OPENROUTER_API_KEY: 'e2e-openrouter-key',
    OPENROUTER_BASE_URL: `http://localhost:${MOCK_PORT}/v1`,
  },
  heartbeatIntervalMs: 500,
} as const

let serve: ServeHandle = await startServe(serveArgs)

let healthy = false
for (let attempt = 0; attempt < 60; attempt++) {
  const probe = await fetch(`${SERVE_URL}/v1/health`, {
    headers: { authorization: `Bearer ${SANDBOX_TOKEN}` },
  }).catch(() => null)
  if (probe !== null && probe.status === 200) {
    healthy = true
    break
  }
  await new Promise((resolve) => setTimeout(resolve, 500))
}
if (!healthy) fail('the serve never answered healthy')
log('serve healthy')

const channel = createRemoteDeltaChannel({
  threadId,
  url: SERVE_URL,
  token: SANDBOX_TOKEN,
  maxAttempts: 2,
  backoffMs: () => 50,
})
const signals: StepSignal[] = []
channel.subscribe({ threadId, listener: (signal) => signals.push(signal) })

const runner = new RemoteTurnRunner({
  channel,
  wake: async () => {
    throw new Error('wake should never fire while the serve is up')
  },
})

await eventLog.append({
  threadId,
  runId: toRunId('run_e2e-turn-1'),
  drafts: [{ type: 'user-said', text: 'say hi' }],
})
const outcome = await runner.runTurn({ threadId })
if (outcome.status !== ETurnStatus.Completed) fail(`turn 1 ended ${JSON.stringify(outcome)}`)
log('turn 1 completed')

const deltaText = signals
  .filter((signal) => signal.type === 'chunk')
  .map((signal) => (signal.chunk.type === 'text-delta' ? signal.chunk.text : ''))
  .join('')
if (!deltaText.includes('Hello from the sandbox')) {
  fail(`no streamed text reached the client; signals: ${signals.map((s) => s.type).join(',')}`)
}
log('streaming reached the client over the socket')

const events = await eventLog.read({ threadId })
if (events.filter((event) => event.type === 'assistant-said').length === 0) {
  fail('the serve never wrote its answer to the control-plane log')
}
log('answer committed to the control-plane log')

const turns = await fetch(`${API}/v1/threads/${threadId}/turns`, {
  headers: { authorization: `Bearer ${userToken}` },
}).then((res) => res.json())
if (!Array.isArray(turns) || turns.length === 0) fail('the turn ledger is empty')
log(`turn ledger recorded ${turns.length} turn(s), status ${turns[0].status}`)

mockAnswers = false
await eventLog.append({
  threadId,
  runId: toRunId('run_e2e-turn-2'),
  drafts: [{ type: 'user-said', text: 'are you there' }],
})
const failedOutcome = await runner.runTurn({ threadId })
if (failedOutcome.status !== ETurnStatus.Failed) {
  fail(`turn 2 should have failed with the mock down, ended ${failedOutcome.status}`)
}
const detail = failedOutcome.status === ETurnStatus.Failed ? failedOutcome.message : ''
if (detail.length === 0) fail('turn 2 failed without a reason reaching the client')
log(`turn 2 failed legibly: ${detail.slice(0, 120)}`)
mockAnswers = true

await serve.close()
log('serve closed (parked)')

serve = await startServe(serveArgs)
channel.wake({ url: SERVE_URL, token: SANDBOX_TOKEN })

const wakingRunner = new RemoteTurnRunner({ channel, wake: async () => undefined })
await eventLog.append({
  threadId,
  runId: toRunId('run_e2e-turn-3'),
  drafts: [{ type: 'user-said', text: 'welcome back' }],
})
const wokenOutcome = await wakingRunner.runTurn({ threadId })
if (wokenOutcome.status !== ETurnStatus.Completed) {
  fail(`turn 3 after the wake ended ${JSON.stringify(wokenOutcome)}`)
}
log('turn 3 completed after the wake')

await serve.close()
channel.close()
mock.close()
console.log('SERVE PHASE GREEN')
process.exit(0)
