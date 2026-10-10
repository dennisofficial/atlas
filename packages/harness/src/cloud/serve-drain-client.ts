import type { Sandbox } from '@vercel/sandbox'
import { z } from 'zod'

import {
  DRIVE_HOME_PATH,
  EVercelFailure,
  SERVE_TOKEN_PATH,
  sandboxDrainReplySchema,
  sandboxRotationReceiptSchema,
  VercelFailure,
  type SandboxRotationReceipt,
} from '@dltech/atlas-wire'
import { SANDBOX_ROTATION_RECEIPT_RELATIVE_PATH } from './sandbox-rotation-receipt'

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

const wedgeHealthSchema = z.looseObject({
  sandboxSessionId: z.string().min(1),
  admissionClosed: z.literal(true),
  busy: z.boolean().optional(),
  turnRunning: z.boolean().optional(),
  childrenRunning: z.number().optional(),
  shellsRunning: z.number().optional(),
  servicesRunning: z.number().optional(),
  pendingInput: z.boolean().optional(),
  settlingWork: z.boolean().optional(),
  clients: z.number().optional(),
})

/**
 * A wedged serve — admission latched, refusing every frame, but process-alive — fails the
 * safe-preparation handshake yet holds nothing worth preserving. It may be replaced only on
 * positive evidence: admission is closed AND every work signal is present and empty. Any work
 * indicator, any missing signal, a closed-but-admitting serve, or a foreign session is preserved.
 */
const wedgeProofOf = (health: unknown, sessionId: string): boolean => {
  const parsed = wedgeHealthSchema.safeParse(health)
  if (!parsed.success) return false
  const h = parsed.data
  if (h.sandboxSessionId !== sessionId) return false
  if (h.busy !== false || h.turnRunning !== false) return false
  if (h.childrenRunning !== 0 || h.shellsRunning !== 0 || h.servicesRunning !== 0) return false
  if (h.pendingInput !== false || h.settlingWork !== false) return false
  return true
}

type PreparationGate = { kind: 'ready' } | { kind: 'wedged' } | { kind: 'legacy' }

const legacyHealthSchema = z.strictObject({ ok: z.boolean() })

const requireSafePreparation = async (args: { sandbox: Sandbox; url: string }): Promise<PreparationGate> => {
  const probe = await args.sandbox.runCommand({
    cmd: 'sh',
    args: ['-c',
      `_serve_token=$(cat ${SERVE_TOKEN_PATH} 2>/dev/null || true); ` +
      `curl -sf -m 5 --connect-timeout 2 -H "Authorization: Bearer $_serve_token" ${shellQuoted(`${args.url}/v1/health`)}`,
    ],
    timeoutMs: 15_000,
  })
  let body: unknown = null
  if (probe.exitCode === 0) {
    try {
      body = JSON.parse((await probe.stdout()) || 'null')
    } catch {
      body = null
    }
  }
  const schema = z.looseObject({ rotationPreparationVersion: z.literal(1), sandboxSessionId: z.string().min(1) })
  const health = schema.safeParse(body)
  if (probe.exitCode === 0 && health.success && health.data.sandboxSessionId === args.sandbox.currentSession().sessionId) {
    return { kind: 'ready' }
  }
  if (wedgeProofOf(body, args.sandbox.currentSession().sessionId)) return { kind: 'wedged' }
  // rotationPreparationVersion and the health sandboxSessionId both first shipped in #1025
  // (tui-v1.61.0), whose serve answered health with exactly `{"ok":true}` before the drain
  // protocol existed — the bearer token is the identity fence there. A drain-capable serve never
  // answers a bare `{"ok":true}` health, so the strict legacy shape cannot swallow one.
  if (probe.exitCode === 0 && legacyHealthSchema.safeParse(body).success) return { kind: 'legacy' }
  throw new VercelFailure({
    kind: EVercelFailure.DrainRefused,
    message: 'this serve cannot confirm safe relocation preparation — the sandbox was preserved',
  })
}

export const drainServe: ServeDrain = async ({ sandbox, url }) => {
  if (await hasPreparedReceipt(sandbox)) return
  const gate = await requireSafePreparation({ sandbox, url })
  // A wedged serve already ended its own processes when it parked and cannot answer a drain —
  // asking it to is the deadlock. Its durable state is on the drive; bypass the drain and let the
  // caller replace it. A legacy serve predates the drain protocol itself — pre-#1025 the harness
  // always replaced these serves without ceremony, so nothing protected is lost.
  if (gate.kind === 'wedged' || gate.kind === 'legacy') return
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
