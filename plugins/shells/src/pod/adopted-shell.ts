import type { RegisteredHook } from '@dltech/atlas-agent'
import { EStage, type AfterTool } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

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
  ctx: Pick<PluginPodContext, 'events'>
  state: ShellPodState
}): RegisteredHook<AfterTool> => ({
  name: 'shells-adopted-bash',
  order: { stage: EStage.Observe, nudge: 0 },
  run: async ({ call, result, projectDirectory }) => {
    if (call.name !== 'bash' || !result.ok) return {}
    const parsed = backgroundedOutputSchema.safeParse(result.output)
    if (!parsed.success) return {}
    const adopted = parsed.data
    args.state.live.note(adopted.shellId)
    if (adopted.input === true) args.state.inputs.add(adopted.shellId)
    if (hasStarted({ events: args.ctx.events(), shellId: adopted.shellId })) return {}
    return {
      drafts: [
        {
          type: 'background-shell-started',
          shellId: adopted.shellId,
          command: adopted.command,
          ...(adopted.description === undefined ? {} : { description: adopted.description }),
          cwd: cwdOf({ input: call.input, projectDirectory }),
        },
      ],
    }
  },
})
