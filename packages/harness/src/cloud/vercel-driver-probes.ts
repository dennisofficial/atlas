import type { Sandbox } from '@vercel/sandbox'

import {
  SANDBOX_HOME_PATH,
  SERVE_LOG_PATH,
  SANDBOX_QUICK_TIMEOUT_MS,
} from '@dltech/atlas-wire'

export async function tailServeLog(sandbox: Sandbox): Promise<string> {
  const read = await sandbox.runCommand({
    cmd: 'sh',
    args: ['-c', `tail -c 3000 ${SERVE_LOG_PATH} 2>/dev/null || echo NO-SERVE-LOG`],
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
    args: ['-c', `mkdir -p ${SANDBOX_HOME_PATH}/bootstrap`],
    timeoutMs: SANDBOX_QUICK_TIMEOUT_MS,
  })
  await args.sandbox.writeFiles([{ path: args.path, content: args.content, mode: 0o600 }])
}
