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

export type ServeDrain = (args: { sandbox: Sandbox; url: string }) => Promise<void>

const shellQuoted = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`

const verifyReceipt = (args: { sandbox: Sandbox; receipt: SandboxRotationReceipt }): void => {
  if (args.receipt.sandboxSessionId !== args.sandbox.currentSession().sessionId) {
    throw new Error('the preparation receipt belongs to another sandbox session — nothing was destroyed')
  }
}

const hasPreparedReceipt = async (sandbox: Sandbox): Promise<boolean> => {
  const probe = await sandbox.runCommand({
    cmd: 'sh',
    args: ['-c', `cat ${SANDBOX_HOME_PATH}/${RUNTIME_CHECKPOINT_RELATIVE_PATH} 2>/dev/null || true`],
    timeoutMs: 15_000,
  })
  const text = (await probe.stdout()).trim()
  if (probe.exitCode !== 0 || text.length === 0) return false
  const parsed = runtimeCheckpointSchema.safeParse(JSON.parse(text))
  if (!parsed.success || parsed.data.phase !== ERuntimePhase.Updating) return false
  return parsed.data.receipt.sandboxSessionId === sandbox.currentSession().sessionId
}

export const drainServe: ServeDrain = async ({ sandbox, url }) => {
  if (await hasPreparedReceipt(sandbox)) return
  const body = JSON.stringify({ reason: DRAIN_REASON })
  try {
    const run = await sandbox.runCommand({
      cmd: 'sh',
      args: [
        '-c',
        `_serve_token=$(cat ${SERVE_TOKEN_PATH} 2>/dev/null || true); ` +
          `curl -s -m ${DRAIN_CURL_TIMEOUT_SECONDS} --connect-timeout 2 -w '\\n%{http_code}' -X POST ` +
          `-H "Authorization: Bearer $_serve_token" -H 'Content-Type: application/json' ` +
          `-d ${shellQuoted(body)} ${shellQuoted(`${url}${SERVE_DRAIN_PATH}`)} 2>/dev/null`,
      ],
      timeoutMs: DRAIN_COMMAND_TIMEOUT_MS,
    })
    const text = (await run.stdout()).trim()
    const split = text.lastIndexOf('\n')
    const status = text.slice(split + 1)
    if (run.exitCode !== 0 || status !== '200') {
      throw new Error(`the serve did not confirm preparation (HTTP ${status || 'unknown'}) — nothing was destroyed`)
    }
    const reply = sandboxDrainReplySchema.parse(JSON.parse(text.slice(0, split)))
    verifyReceipt({ sandbox, receipt: reply.receipt })
    if (!(await hasPreparedReceipt(sandbox))) {
      throw new Error('the serve answered without durable preparation — nothing was destroyed')
    }
  } catch (failure) {
    if (await hasPreparedReceipt(sandbox)) return
    throw failure
  }
}
