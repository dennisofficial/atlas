import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import type { DaemonEventFrame } from '@dltech/atlas-protocol'

import { readDelta } from './cursors'
import type { ShellPodState } from './state'
import { hasEnded, outcomeOf, startedOf } from './status'

export const recordShellEnding = async (args: {
  ctx: PluginPodContext
  state: ShellPodState
  frame: DaemonEventFrame
}): Promise<void> => {
  const { ctx, state, frame } = args
  if (frame.event.type !== 'shells.ended') return
  const { shellId, info } = frame.event
  if (state.endings.has(shellId)) return
  state.endings.add(shellId)
  try {
    await state.starting.get(shellId)
    if (hasEnded({ events: ctx.events(), shellId })) {
      state.cursors.reset(shellId)
      return
    }
    const read = await readDelta({ ctx, cursors: state.cursors, shellId })
    const delta = read.ok
      ? read.value
      : { text: '', droppedCharacters: 0, remainingCharacters: 0, info }
    const outcome = outcomeOf(info)
    const started = startedOf({ events: ctx.events(), shellId })
    await ctx.append([
      {
        type: 'background-shell-ended',
        shellId,
        command: started?.command ?? info.command,
        ...(started?.description === undefined ? {} : { description: started.description }),
        status: outcome.status,
        ...(outcome.killedBy === undefined ? {} : { killedBy: outcome.killedBy }),
        ...(outcome.exitCode === undefined ? {} : { exitCode: outcome.exitCode }),
        output: delta.text,
        droppedCharacters: delta.droppedCharacters,
        remainingCharacters: delta.remainingCharacters,
      },
    ])
    state.cursors.reset(shellId)
  } catch (error) {
    state.endings.delete(shellId)
    ctx.log(`shells: recording the ending of ${shellId} failed: ${String(error)}`)
  }
}
