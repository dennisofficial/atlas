import type { Sandbox } from '@vercel/sandbox'
import { z } from 'zod'
import { sandboxDrainReplySchema, sandboxRotationReceiptSchema, type SandboxRotationReceipt } from '@dltech/atlas-wire'

import { DRIVE_HOME_PATH } from './drive-names'
import { SANDBOX_ROTATION_RECEIPT_RELATIVE_PATH } from './sandbox-rotation-receipt'
import { SERVE_TOKEN_PATH } from './serve-launch'

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
    args: ['-c', `cat ${DRIVE_HOME_PATH}/${SANDBOX_ROTATION_RECEIPT_RELATIVE_PATH} 2>/dev/null || true`],
    timeoutMs: 15_000,
  })
  const text = (await probe.stdout()).trim()
  if (probe.exitCode !== 0 || text.length === 0) return false
  const parsed = sandboxRotationReceiptSchema.safeParse(JSON.parse(text))
  if (!parsed.success) return false
  return parsed.data.sandboxSessionId === sandbox.currentSession().sessionId
}

const requireSafePreparation = async (args: { sandbox: Sandbox; url: string }): Promise<void> => {
  const probe = await args.sandbox.runCommand({
    cmd: 'sh',
    args: ['-c',
      `_serve_token=$(cat ${SERVE_TOKEN_PATH} 2>/dev/null || true); ` +
      `curl -sf -m 5 --connect-timeout 2 -H "Authorization: Bearer $_serve_token" ${shellQuoted(`${args.url}/v1/health`)}`,
    ],
    timeoutMs: 15_000,
  })
  const schema = z.looseObject({ rotationPreparationVersion: z.literal(1), sandboxSessionId: z.string().min(1) })
  const health = schema.safeParse(JSON.parse((await probe.stdout()) || 'null'))
  if (probe.exitCode !== 0 || !health.success || health.data.sandboxSessionId !== args.sandbox.currentSession().sessionId) {
    throw new Error('this serve cannot confirm safe relocation preparation — the sandbox was preserved')
  }
}

export const drainServe: ServeDrain = async ({ sandbox, url }) => {
  if (await hasPreparedReceipt(sandbox)) return
  await requireSafePreparation({ sandbox, url })
  const body = JSON.stringify({ reason: DRAIN_REASON, preparationVersion: 1 })
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
