import { randomUUID } from 'node:crypto'
import { TriggerClient } from '@trigger.dev/sdk'
import { TriggerJobDispatcher } from '../src/_lib/trigger/trigger-job-dispatcher'
import { type SmokeTask, smokeTaskContract } from '../src/trigger/smoke/smoke.contract'

const TIMEOUT_MS = 120_000
const POLL_INTERVAL_MS = 2_000

function requireSecretKey(): string {
  const key = process.env.TRIGGER_SECRET_KEY
  if (!key || key.startsWith('encrypted:')) {
    throw new Error('TRIGGER_SECRET_KEY is missing or still encrypted')
  }
  return key
}

async function waitForRun({ client, runId }: { client: TriggerClient; runId: string }) {
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    const run = await client.runs.retrieve<SmokeTask>(runId)
    if (run.isCompleted) return run
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new Error(`atlas-smoke run ${runId} did not finish within ${TIMEOUT_MS / 1000}s`)
}

const secretKey = requireSecretKey()
const { runId } = await new TriggerJobDispatcher({ secretKey }).dispatch({
  task: smokeTaskContract,
  payload: {},
  idempotencyKey: `atlas-smoke-${randomUUID()}`,
  tags: ['smoke'],
})
console.log(`triggered atlas-smoke as ${runId}`)

const run = await waitForRun({ client: new TriggerClient({ accessToken: secretKey }), runId })
if (!run.isSuccess || run.output?.ok !== true) {
  console.error(
    `atlas-smoke ${runId} ended ${run.status}: ${JSON.stringify(run.error ?? run.output)}`,
  )
  process.exit(1)
}
console.log(`atlas-smoke ${runId} ${run.status}: ${JSON.stringify(run.output)}`)
