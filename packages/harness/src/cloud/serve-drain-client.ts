import type { Sandbox } from '@vercel/sandbox'

import { SERVE_TOKEN_PATH } from './serve-launch'

export const SERVE_DRAIN_PATH = '/v1/drain'
export const DRAIN_REASON = 'the wire protocol drifted — rotating the sandbox'
export const DRAIN_COMMAND_TIMEOUT_MS = 45_000
const DRAIN_CURL_TIMEOUT_SECONDS = 40

export type ServeDrain = (args: { sandbox: Sandbox; url: string }) => Promise<void>

const shellQuoted = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`

export const drainServe: ServeDrain = async ({ sandbox, url }) => {
  const body = JSON.stringify({ reason: DRAIN_REASON })
  const run = await sandbox.runCommand({
    cmd: 'sh',
    args: [
      '-c',
      `_serve_token=$(cat ${SERVE_TOKEN_PATH} 2>/dev/null || true); ` +
        `curl -s -m ${DRAIN_CURL_TIMEOUT_SECONDS} --connect-timeout 2 -o /dev/null -w '%{http_code}' -X POST ` +
        `-H "Authorization: Bearer $_serve_token" -H 'Content-Type: application/json' ` +
        `-d ${shellQuoted(body)} ${url}${SERVE_DRAIN_PATH} 2>/dev/null || true`,
    ],
    timeoutMs: DRAIN_COMMAND_TIMEOUT_MS,
  })
  const status = (await run.stdout()).trim()
  if (status === '200') return
  throw new Error(
    status === '' || status === '000'
      ? 'the serve did not answer the drain (already exited or unreachable)'
      : `the serve answered the drain with HTTP ${status}`,
  )
}
