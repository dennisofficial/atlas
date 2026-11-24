import type { RegisteredHook } from '@dltech/atlas-agent'
import { EStage, type AfterTool, type EventDraft } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import { recordShellEnding } from './ending'
import type { ShellPodState } from './state'
import { hasStarted } from './status'

const backgroundedOutputSchema = z.object({
  backgrounded: z.literal(true),
  shellId: z.string().min(1),
  command: z.string().min(1),
  description: z.string().optional(),
  input: z.literal(true).optional(),
})

const workdirSchema = z.object({ workdir: z.string().min(1).optional() })

const cwdOf = (args: { input: unknown; projectDirectory: string }): string => {
  const parsed = workdirSchema.safeParse(args.input)
  if (!parsed.success) return args.projectDirectory
  return parsed.data.workdir ?? args.projectDirectory
}

export const adoptedShellHook = (args: {
  ctx: PluginPodContext
  state: ShellPodState
}): RegisteredHook<AfterTool> => ({
  name: 'shells-adopted-bash',
  order: { stage: EStage.Observe, nudge: 0 },
  run: async ({ call, result, projectDirectory }) => {
    if (call.name !== 'bash' || !result.ok) return {}
    const parsed = backgroundedOutputSchema.safeParse(result.output)
    if (!parsed.success) return {}
    const adopted = parsed.data
    if (adopted.input === true) args.state.inputs.add(adopted.shellId)
    if (hasStarted({ events: args.ctx.events(), shellId: adopted.shellId })) return {}
    const started: EventDraft = {
      type: 'background-shell-started',
      shellId: adopted.shellId,
      command: adopted.command,
      ...(adopted.description === undefined ? {} : { description: adopted.description }),
      cwd: cwdOf({ input: call.input, projectDirectory }),
    }
    const ending = args.state.unclaimed.get(adopted.shellId)
    if (ending === undefined) {
      args.state.live.note(adopted.shellId)
      return { drafts: [started] }
    }
    args.state.unclaimed.delete(adopted.shellId)
    await args.ctx.append([started])
    await recordShellEnding({ ctx: args.ctx, state: args.state, frame: ending })
    return {}
  },
})
