import type { Sandbox } from '@vercel/sandbox'

import {
  DRIVE_HOME_PATH,
  LEGACY_SERVE_LOG_PATH,
  SERVE_LOG_PATH,
  SANDBOX_QUICK_TIMEOUT_MS,
} from '@dltech/atlas-wire'

export async function tailServeLog(sandbox: Sandbox): Promise<string> {
  const read = await sandbox.runCommand({
    cmd: 'sh',
    args: ['-c', `tail -c 3000 ${SERVE_LOG_PATH} 2>/dev/null || tail -c 3000 ${LEGACY_SERVE_LOG_PATH} 2>/dev/null || echo NO-SERVE-LOG`],
    timeoutMs: SANDBOX_QUICK_TIMEOUT_MS,
  })
  return (await read.stdout()).trim()
}

export async function writeBootstrapFile(args: {
  sandbox: Sandbox
  path: string
  content: Uint8Array | string
}): Promise<void> {
  await args.sandbox.runCommand({
    cmd: 'sh',
    args: ['-c', `mkdir -p ${DRIVE_HOME_PATH}/bootstrap`],
    timeoutMs: SANDBOX_QUICK_TIMEOUT_MS,
  })
  await args.sandbox.writeFiles([{ path: args.path, content: args.content, mode: 0o600 }])
}

export async function transcriptPresent(sandbox: Sandbox): Promise<boolean> {
  const probe = await sandbox.runCommand({
    cmd: 'sh',
    args: ['-c', `test -s ${DRIVE_HOME_PATH}/bootstrap/transcript.tar.gz`],
    timeoutMs: SANDBOX_QUICK_TIMEOUT_MS,
  })
  return probe.exitCode === 0
}
