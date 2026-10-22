import type { Sandbox } from '@vercel/sandbox'

import {
  ERuntimePhase,
  SANDBOX_HOME_PATH,
  SERVE_TOKEN_PATH,
  runtimeCheckpointSchema,
  sandboxDrainReplySchema,
  type SandboxRotationReceipt,
} from '@dltech/atlas-wire'
import { RUNTIME_CHECKPOINT_RELATIVE_PATH } from './runtime-checkpoint'

export const SERVE_DRAIN_PATH = '/v1/drain'
export const DRAIN_REASON = 'cloud sandbox update'
export const DRAIN_COMMAND_TIMEOUT_MS = 45_000
const DRAIN_CURL_TIMEOUT_SECONDS = 40

export const DRAIN_SEAL_DEADLINE_MS = 12 * 60 * 1000
export const DRAIN_SEAL_POLL_MS = 5_000

export type DrainSealBudget = { deadlineMs: number; pollMs: number }

const DEFAULT_SEAL_BUDGET: DrainSealBudget = {
  deadlineMs: DRAIN_SEAL_DEADLINE_MS,
  pollMs: DRAIN_SEAL_POLL_MS,
}

export type ServeDrain = (args: {
  sandbox: Sandbox
  url: string
  sealBudget?: DrainSealBudget | undefined
}) => Promise<void>

type DrainAnswer = { status: string; body: string }

const ANSWERED_STATUS = /^[1-5]\d\d$/

const shellQuoted = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const verifyReceipt = (args: { sandbox: Sandbox; receipt: SandboxRotationReceipt }): void => {
  if (args.receipt.sandboxSessionId !== args.sandbox.currentSession().sessionId) {
    throw new Error(
      'the preparation receipt belongs to another sandbox session — nothing was destroyed',
    )
  }
}

const parsedRecordOf = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const hasPreparedReceipt = async (sandbox: Sandbox): Promise<boolean> => {
  const probe = await sandbox.runCommand({
    cmd: 'sh',
    args: [
      '-c',
      `cat ${SANDBOX_HOME_PATH}/${RUNTIME_CHECKPOINT_RELATIVE_PATH} 2>/dev/null || true`,
    ],
    timeoutMs: 15_000,
  })
  const text = (await probe.stdout()).trim()
  if (probe.exitCode !== 0 || text.length === 0) return false
  const parsed = runtimeCheckpointSchema.safeParse(parsedRecordOf(text))
  if (!parsed.success || parsed.data.phase !== ERuntimePhase.Updating) return false
  return parsed.data.receipt.sandboxSessionId === sandbox.currentSession().sessionId
}

const requestDrain = async (args: {
  sandbox: Sandbox
  url: string
}): Promise<DrainAnswer | undefined> => {
  const body = JSON.stringify({ reason: DRAIN_REASON })
  const run = await args.sandbox
    .runCommand({
      cmd: 'sh',
      args: [
        '-c',
        `_serve_token=$(cat ${SERVE_TOKEN_PATH} 2>/dev/null || true); ` +
          `curl -s -m ${DRAIN_CURL_TIMEOUT_SECONDS} --connect-timeout 2 -w '\\n%{http_code}' -X POST ` +
          `-H "Authorization: Bearer $_serve_token" -H 'Content-Type: application/json' ` +
          `-d ${shellQuoted(body)} ${shellQuoted(`${args.url}${SERVE_DRAIN_PATH}`)} 2>/dev/null`,
      ],
      timeoutMs: DRAIN_COMMAND_TIMEOUT_MS,
    })
    .catch(() => undefined)
  if (run === undefined) return undefined
  const text = (await run.stdout()).trim()
  const split = text.lastIndexOf('\n')
  const status = text.slice(split + 1)
  if (run.exitCode !== 0 || !ANSWERED_STATUS.test(status)) return undefined
  return { status, body: text.slice(0, split) }
}

const awaitSeal = async (args: {
  sandbox: Sandbox
  requestedAt: number
  budget: DrainSealBudget
}): Promise<void> => {
  const deadline = args.requestedAt + args.budget.deadlineMs
  while (!(await hasPreparedReceipt(args.sandbox).catch(() => false))) {
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) {
      throw new Error(
        `the serve did not confirm preparation within ${Math.round(args.budget.deadlineMs / 1000)}s of the drain request (HTTP 000) — nothing was destroyed`,
      )
    }
    await sleep(Math.min(args.budget.pollMs, remainingMs))
  }
}

const confirmAnswer = async (args: { sandbox: Sandbox; answer: DrainAnswer }): Promise<void> => {
  if (args.answer.status !== '200') {
    throw new Error(
      `the serve did not confirm preparation (HTTP ${args.answer.status}) — nothing was destroyed`,
    )
  }
  const reply = sandboxDrainReplySchema.parse(JSON.parse(args.answer.body))
  verifyReceipt({ sandbox: args.sandbox, receipt: reply.receipt })
  if (!(await hasPreparedReceipt(args.sandbox))) {
    throw new Error('the serve answered without durable preparation — nothing was destroyed')
  }
}

export const drainServe: ServeDrain = async ({ sandbox, url, sealBudget }) => {
  if (await hasPreparedReceipt(sandbox)) return
  const requestedAt = Date.now()
  try {
    const answer = await requestDrain({ sandbox, url })
    if (answer === undefined) {
      await awaitSeal({ sandbox, requestedAt, budget: sealBudget ?? DEFAULT_SEAL_BUDGET })
      return
    }
    await confirmAnswer({ sandbox, answer })
  } catch (failure) {
    if (await hasPreparedReceipt(sandbox)) return
    throw failure
  }
}
