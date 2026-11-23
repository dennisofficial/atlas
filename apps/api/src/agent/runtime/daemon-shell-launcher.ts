import { nextKey, type RemoteCalls } from '@dltech/atlas-host'
import { ECallStatus } from '@dltech/atlas-protocol'

import {
  ShellLauncher,
  type ShellLaunchArgs,
  type ShellLaunchOutcome,
} from '../agent-tools/shell-launcher'

const WRONG_ANSWER = 'the daemon answered a different operation than the one asked'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export class DaemonShellLauncher extends ShellLauncher {
  constructor(private readonly deps: { calls: Pick<RemoteCalls, 'invoke'> }) {
    super()
  }

  async launch(args: ShellLaunchArgs): Promise<ShellLaunchOutcome> {
    try {
      const result = await this.deps.calls.invoke({
        key: nextKey(),
        signal: args.signal,
        op: {
          op: 'shells.launch',
          shellId: args.shellId,
          command: args.command,
          cwd: args.cwd,
          env: args.env,
          input: args.input,
          ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
        },
      })
      if (result.status !== ECallStatus.Ok) return { ok: false, reason: result.error.message }
      if (result.op !== 'shells.launch') return { ok: false, reason: WRONG_ANSWER }
      return { ok: true, pid: result.value.pid }
    } catch (error) {
      return { ok: false, reason: messageOf(error) }
    }
  }
}
