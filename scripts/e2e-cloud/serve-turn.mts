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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type MockMessage = { role?: string; content?: unknown }

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) =>
      typeof part === 'object' && part !== null && 'text' in part
        ? String((part as { text: unknown }).text)
        : '',
    )
    .join('')
}

const sse = (args: { delta: object; finishReason?: string; usage?: object }): string =>
  `data: ${JSON.stringify({
    id: 'chatcmpl-e2e',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'mock',
    choices: [
      {
        index: 0,
        delta: args.delta,
        ...(args.finishReason === undefined ? {} : { finish_reason: args.finishReason }),
      },
    ],
    ...(args.usage === undefined ? {} : { usage: args.usage }),
  })}\n\n`

const USAGE = { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 }

const streamText = (response: http.ServerResponse, text: string): void => {
  response.write(sse({ delta: { role: 'assistant', content: '' } }))
  response.write(sse({ delta: { content: text } }))
  response.write(sse({ delta: {}, finishReason: 'stop', usage: USAGE }))
  response.write('data: [DONE]\n\n')
  response.end()
}

const streamToolCall = (response: http.ServerResponse): void => {
  response.write(
    sse({
      delta: {
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: 'call_e2e_spawn',
            type: 'function',
            function: {
              name: 'agent_spawn',
              arguments: JSON.stringify({
                agentType: 'explore',
                intent: 'Probe the workspace',
                brief: 'look around and report back',
              }),
            },
          },
        ],
      },
    }),
  )
  response.write(sse({ delta: {}, finishReason: 'tool_calls', usage: USAGE }))
  response.write('data: [DONE]\n\n')
  response.end()
}

const streamSlow = (response: http.ServerResponse): void => {
  response.write(sse({ delta: { role: 'assistant', content: '' } }))
  const parts = ['slow-one ', 'slow-two ', 'slow-three']
  let index = 0
  const tick = (): void => {
    const part = parts[index]
    if (part === undefined) {
      response.write(sse({ delta: {}, finishReason: 'stop', usage: USAGE }))
      response.write('data: [DONE]\n\n')
      response.end()
      return
    }
    index += 1
    response.write(sse({ delta: { content: part } }))
    setTimeout(tick, 600)
  }
  setTimeout(tick, 600)
}

// A canned OpenAI-compatible model. "send a helper" is answered with an agent_spawn tool call;
// the sub-agent's own request (its brief says "look around") gets the child's report; a request
// carrying a tool result is the parent continuing after the spawn. "take your time" streams over
// two seconds, so a client can die mid-turn and another can resume the stream. When told to stop
// answering, it fails fast with a 400 (non-retryable), which is how the failure leg is driven.
let mockAnswers = true
const mock = http.createServer((request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions' || !mockAnswers) {
    response.writeHead(400, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'the mock model is down' } }))
    return
  }
  let body = ''
  request.on('data', (chunk: Buffer) => {
    body += chunk.toString()
  })
  request.on('end', () => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const messages = (JSON.parse(body).messages ?? []) as MockMessage[]
    const said = messages
      .filter((message) => message.role === 'user')
      .map((message) => textOf(message.content))
      .join('\n')
    if (messages.at(-1)?.role === 'tool') {
      streamText(response, 'The helper is on it.')
      return
    }
    if (said.includes('look around')) {
      streamText(response, 'child-report: all clear')
      return
    }
    if (said.includes('take your time')) {
      streamSlow(response)
      return
    }
    // Spawning is armed only while no turn has ever run a tool: any later request carries the
    // spawn's own tool result in its history, and matching markers across history loops forever.
    if (said.includes('send a helper') && !messages.some((message) => message.role === 'tool')) {
      streamToolCall(response)
      return
    }
    streamText(response, 'Hello from the sandbox')
  })
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
const skillsBundle = JSON.stringify({
  '.atlas/skills/e2e-skill/SKILL.md': Buffer.from('# e2e skill').toString('base64'),
})
const sql = `INSERT INTO "CloudSandbox" (id, "threadId", "userId", "sandboxId", name, region, state, "lastActivityAt", "tokenHash", "workspaceSkills", "createdAt", "updatedAt") VALUES ('sbx_e2e_${Date.now()}', '${threadId}', '${userId}', 'vsbx_e2e', 'atlas-thread-e2e', 'iad1', 'running', now(), '${tokenHash}', '${skillsBundle}', now(), now()) ON CONFLICT ("threadId") DO UPDATE SET "tokenHash" = EXCLUDED."tokenHash", state = 'running', "lastActivityAt" = now(), "workspaceSkills" = EXCLUDED."workspaceSkills"`
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
  await sleep(500)
}
if (!healthy) fail('the serve never answered healthy')
log('serve healthy')

const skillText = await Bun.file(
  '/tmp/e2e-cloud-serve-home/skills/e2e-skill/SKILL.md',
)
  .text()
  .catch(() => null)
if (skillText !== '# e2e skill') {
  fail(`the skills bundle did not materialize on the serve: ${skillText}`)
}
log("the operator's skills bundle materialized on the serve")

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

await eventLog.append({
  threadId,
  runId: toRunId('run_e2e-turn-2'),
  drafts: [{ type: 'user-said', text: 'send a helper' }],
})
const spawnOutcome = await runner.runTurn({ threadId })
if (spawnOutcome.status !== ETurnStatus.Completed) {
  fail(`turn 2 (spawning a sub-agent) ended ${JSON.stringify(spawnOutcome)}`)
}
log('turn 2 completed: the parent spawned a sub-agent')

let childId: string | undefined
for (let attempt = 0; attempt < 30 && childId === undefined; attempt++) {
  const spawned = await fetch(`${API}/v1/threads/${threadId}/spawned`, {
    headers: { authorization: `Bearer ${userToken}` },
  })
    .then((res) => res.json())
    .catch(() => null)
  if (Array.isArray(spawned) && spawned.length > 0) {
    childId = (spawned[0] as { id: string }).id
    break
  }
  await sleep(1_000)
}
if (childId === undefined) fail('the sub-agent thread never appeared in the control plane')
log(`sub-agent thread registered: ${childId}`)

// The API throttles at 100 requests/minute across everything the rig has already done, so these
// polls stay well under it.
let childAnswered = false
let childReadStatus = 0
let lastChildEvents = ''
for (let attempt = 0; attempt < 40 && !childAnswered; attempt++) {
  const reading = await fetch(`${API}/v1/threads/${childId}/events`, {
    headers: { authorization: `Bearer ${SANDBOX_TOKEN}` },
  }).catch(() => null)
  if (reading === null) {
    await sleep(1_000)
    continue
  }
  childReadStatus = reading.status
  if (reading.status === 200) {
    lastChildEvents = JSON.stringify(await reading.json())
    childAnswered = lastChildEvents.includes('child-report: all clear')
  }
  if (!childAnswered) await sleep(1_000)
}
if (childReadStatus !== 200) {
  fail(`the sandbox token cannot read the sub-agent's thread: last status ${childReadStatus}`)
}
if (!childAnswered) {
  fail(`the sub-agent's answer never landed in its thread; events: ${lastChildEvents.slice(0, 600)}`)
}
log("sub-agent's answer committed and readable with the sandbox token")

const streamedText = (collected: StepSignal[]): string =>
  collected
    .filter((signal) => signal.type === 'chunk')
    .map((signal) => (signal.chunk.type === 'text-delta' ? signal.chunk.text : ''))
    .join('')

await eventLog.append({
  threadId,
  runId: toRunId('run_e2e-turn-3'),
  drafts: [{ type: 'user-said', text: 'take your time' }],
})
const abandonedTurn = runner.runTurn({ threadId })
void abandonedTurn.catch(() => undefined)

for (let attempt = 0; attempt < 40 && !streamedText(signals).includes('slow-one'); attempt++) {
  await sleep(250)
}
if (!streamedText(signals).includes('slow-one')) fail('the slow turn never started streaming')
log('turn 3 streaming; the client now dies mid-turn')

channel.close()

const resumedChannel = createRemoteDeltaChannel({
  threadId,
  url: SERVE_URL,
  token: SANDBOX_TOKEN,
  maxAttempts: 2,
  backoffMs: () => 50,
  lastEventSeq: () => 0,
})
const resumedSignals: StepSignal[] = []
resumedChannel.subscribe({ threadId, listener: (signal) => resumedSignals.push(signal) })
const turnEnded = new Promise<unknown>((resolve) => {
  resumedChannel.onTurnEnded((outcome) => resolve(outcome))
})
const outcome3 = await Promise.race([turnEnded, sleep(20_000).then(() => null)])
const status3 = (outcome3 as { status?: string } | null)?.status
if (status3 !== ETurnStatus.Completed) {
  fail(`turn 3 should have completed on the serve with the first client gone, got ${JSON.stringify(outcome3)}`)
}
const resumedText = streamedText(resumedSignals)
if (
  !resumedText.includes('slow-one') ||
  !resumedText.includes('slow-two') ||
  !resumedText.includes('slow-three')
) {
  fail(`the resumed stream lost part of the in-flight answer: ${resumedText}`)
}
log('the in-flight turn resumed on a fresh client and completed on the serve')

const afterDeath = await eventLog.read({ threadId })
const slowAnswers = afterDeath.filter(
  (event) => event.type === 'assistant-said' && JSON.stringify(event).includes('slow-three'),
)
if (slowAnswers.length !== 1) {
  fail(`the turn whose client died committed ${slowAnswers.length} times, not once`)
}
log('the turn ran exactly once — no restart on reconnect')

const runnerOnResumed = new RemoteTurnRunner({
  channel: resumedChannel,
  wake: async () => {
    throw new Error('wake should never fire while the serve is up')
  },
})

mockAnswers = false
await eventLog.append({
  threadId,
  runId: toRunId('run_e2e-turn-4'),
  drafts: [{ type: 'user-said', text: 'are you there' }],
})
const failedOutcome = await runnerOnResumed.runTurn({ threadId })
if (failedOutcome.status !== ETurnStatus.Failed) {
  fail(`turn 4 should have failed with the mock down, ended ${failedOutcome.status}`)
}
const detail = failedOutcome.status === ETurnStatus.Failed ? failedOutcome.message : ''
if (detail.length === 0) fail('turn 4 failed without a reason reaching the client')
log(`turn 4 failed legibly: ${detail.slice(0, 120)}`)
mockAnswers = true

await serve.close()
log('serve closed (parked)')

serve = await startServe(serveArgs)
resumedChannel.wake({ url: SERVE_URL, token: SANDBOX_TOKEN })

const wakingRunner = new RemoteTurnRunner({ channel: resumedChannel, wake: async () => undefined })
await eventLog.append({
  threadId,
  runId: toRunId('run_e2e-turn-5'),
  drafts: [{ type: 'user-said', text: 'welcome back' }],
})
const wokenOutcome = await wakingRunner.runTurn({ threadId })
if (wokenOutcome.status !== ETurnStatus.Completed) {
  fail(`turn 5 after the wake ended ${JSON.stringify(wokenOutcome)}`)
}
log('turn 5 completed after the wake')

await serve.close()
resumedChannel.close()
mock.close()
console.log('SERVE PHASE GREEN')
process.exit(0)
