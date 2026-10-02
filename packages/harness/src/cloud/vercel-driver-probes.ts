import type { Sandbox } from '@vercel/sandbox'

import { DRIVE_HOME_PATH } from './drive-names'
import { SERVE_LOG_PATH } from './serve-launch'
import { SANDBOX_QUICK_TIMEOUT_MS } from './vercel-driver-sdk'

export async function tailServeLog(sandbox: Sandbox): Promise<string> {
  const read = await sandbox.runCommand({
    cmd: 'sh',
    args: ['-c', `tail -c 3000 ${SERVE_LOG_PATH} 2>/dev/null || echo NO-SERVE-LOG`],
    timeoutMs: SANDBOX_QUICK_TIMEOUT_MS,
  })
  return (await read.stdout()).trim()
}

export async function transcriptPresent(sandbox: Sandbox): Promise<boolean> {
  const probe = await sandbox.runCommand({
    cmd: 'sh',
    args: ['-c', `test -s ${DRIVE_HOME_PATH}/bootstrap/transcript.tar.gz`],
    timeoutMs: SANDBOX_QUICK_TIMEOUT_MS,
  })
  return probe.exitCode === 0
}
