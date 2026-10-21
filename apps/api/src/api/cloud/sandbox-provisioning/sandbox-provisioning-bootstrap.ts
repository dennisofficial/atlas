import type { Sandbox } from '@vercel/sandbox'
import { SANDBOX_HOME_PATH, SANDBOX_QUICK_TIMEOUT_MS } from '@dltech/atlas-wire'

const BOOTSTRAP_DIRECTORY = `${SANDBOX_HOME_PATH}/bootstrap`
export const WORKSPACE_SPEC_PATH = `${BOOTSTRAP_DIRECTORY}/workspace-spec.json`

export function workspaceSpecWriter(args: {
  projectId: string
  model: string | null
}): (sandbox: Sandbox) => Promise<void> {
  const content = JSON.stringify({
    remoteUrl: null,
    githubToken: null,
    projectId: args.projectId,
    model: args.model ?? undefined,
  })
  return async (sandbox) => {
    await sandbox.runCommand({
      cmd: 'sh',
      args: ['-c', `mkdir -p ${BOOTSTRAP_DIRECTORY}`],
      timeoutMs: SANDBOX_QUICK_TIMEOUT_MS,
    })
    await sandbox.writeFiles([{ path: WORKSPACE_SPEC_PATH, content, mode: 0o600 }])
  }
}
