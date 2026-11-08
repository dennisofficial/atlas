import { EMPTY_POD, type PodSlot } from '@dltech/atlas-plugin-sdk'

import { recordShellEnding } from './ending'
import { BackgroundShellsFragment } from './fragment'
import { ShellInputTool } from './input-tool'
import { ShellKillTool } from './kill-tool'
import { ShellListTool } from './list-tool'
import { ShellOutputTool } from './output-tool'
import { runningRosterHook } from './roster-hook'
import { ShellTool } from './start-tool'
import { stateFor } from './state'

export { BackgroundShellsFragment } from './fragment'
export { looksLikePrompt } from './prompt-sniff'
export { withRunningRoster } from './roster-message'

export const SHELL_TOOLS = [
  'shell',
  'shell_output',
  'shell_input',
  'shell_kill',
  'shell_list',
] as const

export const shellsPod: PodSlot = {
  ...EMPTY_POD,
  tools: (ctx) => {
    const state = stateFor(ctx)
    return [
      new ShellTool(ctx, state),
      new ShellOutputTool(ctx, state),
      new ShellInputTool(ctx, state),
      new ShellKillTool(ctx, state),
      new ShellListTool(ctx, state),
    ]
  },
  hooks: (ctx) => {
    const state = stateFor(ctx)
    ctx.onDaemonEvent((frame) => void recordShellEnding({ ctx, state, frame }))
    return { beforeStep: [runningRosterHook(ctx)] }
  },
  prompts: [new BackgroundShellsFragment()],
  commands: new Map(),
}
