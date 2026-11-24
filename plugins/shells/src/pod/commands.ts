import type { CommandHandler } from '@dltech/atlas-commands'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { shellKillArgs } from '../core/commands'
import { killShell } from './daemon'
import { stateFor } from './state'

export const shellKillHandlerOf =
  (ctx: PluginPodContext): CommandHandler<unknown> =>
  async ({ args }) => {
    const parsed = shellKillArgs.safeParse(args)
    if (!parsed.success) return { kind: 'refused', reason: parsed.error.message }
    const { shellId } = parsed.data
    const killed = await killShell({ ctx, shellId })
    if (!killed.ok) return { kind: 'refused', reason: killed.reason }
    stateFor(ctx).awaiting.delete(shellId)
    ctx.log(`killed shell ${shellId}`)
    return { kind: 'done' }
  }
