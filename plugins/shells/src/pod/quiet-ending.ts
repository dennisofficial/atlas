import { EKilledBy, EShellEndCause, EShellStatus, type ShellLifecycle } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import type { ShellPodState } from './state'
import { hasEnded } from './status'

export const recordQuietShellEnding = async (args: {
  ctx: PluginPodContext
  state: ShellPodState
  shell: ShellLifecycle
}): Promise<void> => {
  const { ctx, state, shell } = args
  if (state.endings.has(shell.shellId)) return
  state.endings.add(shell.shellId)
  try {
    if (hasEnded({ events: ctx.events(), shellId: shell.shellId })) return
    await ctx.notify(
      {
        type: 'background-shell-ended',
        shellId: shell.shellId,
        command: shell.command,
        ...(shell.description === undefined ? {} : { description: shell.description }),
        ...(shell.bootId === undefined ? {} : { bootId: shell.bootId }),
        status: EShellStatus.Killed,
        killedBy: EKilledBy.Unrecorded,
        cause: EShellEndCause.PodRestarted,
        output: '',
        droppedCharacters: 0,
        remainingCharacters: 0,
      },
      { key: `background-shell-ended:${shell.shellId}` },
    )
  } catch (error) {
    state.endings.delete(shell.shellId)
    ctx.log(`shells: recording the lost ending of ${shell.shellId} failed: ${String(error)}`)
  }
}
