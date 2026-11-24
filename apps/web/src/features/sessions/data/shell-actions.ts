import type { SessionCommandInput, SessionCommandOutput } from '@dltech/atlas-protocol'

export const SHELL_KILL_COMMAND = 'shell-kill'

export type ShellActionApi = {
  command(input: SessionCommandInput): Promise<SessionCommandOutput>
}

export const killShell = async (args: {
  api: ShellActionApi
  sessionId: string
  shellId: string
}): Promise<void> => {
  await args.api.command({
    sessionId: args.sessionId,
    name: SHELL_KILL_COMMAND,
    args: { shellId: args.shellId },
  })
}
