import { EMPTY_POD, type PodSlot } from '@dltech/atlas-plugin-sdk'

import { adoptedShellHook } from './adopted-shell'
import { recordShellEnding } from './ending'
import { BackgroundShellsFragment } from './fragment'
import { ShellInputTool } from './input-tool'
import { ShellKillTool } from './kill-tool'
import { ShellListTool } from './list-tool'
import { ShellOutputTool } from './output-tool'
import { reconcileShells } from './reconcile'
import { stateFor } from './state'

export { BackgroundShellsFragment } from './fragment'
export { looksLikePrompt } from './prompt-sniff'

export const SHELL_TOOLS = ['shell_output', 'shell_input', 'shell_kill', 'shell_list'] as const

export const shellsPod: PodSlot = {
  ...EMPTY_POD,
  tools: (ctx) => {
    const state = stateFor(ctx)
    return [
      new ShellOutputTool(ctx, state),
      new ShellInputTool(ctx, state),
      new ShellKillTool(ctx, state),
      new ShellListTool(ctx, state),
    ]
  },
  hooks: (ctx) => {
    const state = stateFor(ctx)
    ctx.onDaemonEvent((frame) => {
      void recordShellEnding({ ctx, state, frame })
      if (frame.event.type === 'shells.output') void state.live.note(frame.event.shellId)
      if (frame.event.type === 'shells.ended') state.live.forget(frame.event.shellId)
    })
    void reconcileShells({ ctx, state })
    return { afterTool: [adoptedShellHook({ ctx, state })] }
  },
  prompts: [new BackgroundShellsFragment()],
  commands: new Map(),
}
