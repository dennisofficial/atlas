import { DAEMON_PORT } from '@dltech/atlas-protocol'
import type { Sandbox } from '@vercel/sandbox'

import { sandboxSh } from './sandbox-sh'

const DAEMON_CPU_TIMEOUT_MS = 10_000
const TOKEN_ENV = 'ATLAS_CPU_TOKEN'

export const daemonCpuUsecFromAnswer = (text: string): number | undefined => {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof body !== 'object' || body === null || !('usageUsec' in body)) return undefined
  const { usageUsec } = body
  if (typeof usageUsec !== 'number' || !Number.isFinite(usageUsec) || usageUsec < 0)
    return undefined
  return Math.floor(usageUsec)
}

export const daemonCpuUsecOf = async (args: {
  sandbox: Sandbox
  token: string
  timeoutMs?: number | undefined
}): Promise<number | undefined> => {
  try {
    const run = await sandboxSh({
      sandbox: args.sandbox,
      script: `curl -s -m 5 -H "authorization: Bearer $${TOKEN_ENV}" 'http://localhost:${DAEMON_PORT}/cpu'`,
      timeoutMs: args.timeoutMs ?? DAEMON_CPU_TIMEOUT_MS,
      env: { [TOKEN_ENV]: args.token },
    })
    if (typeof run.stdout !== 'function') return undefined
    return daemonCpuUsecFromAnswer(await run.stdout())
  } catch {
    return undefined
  }
}
