import { lostShellsOf, type Event } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { EShellRunStatus } from '@dltech/atlas-protocol'

import { listShells } from './daemon'
import { recordShellEnding } from './ending'
import { recordQuietShellEnding } from './quiet-ending'
import type { ShellPodState } from './state'

export const reconcileShells = async (args: {
  ctx: PluginPodContext
  state: ShellPodState
}): Promise<void> => {
  const { ctx, state } = args
  const open = lostShellsOf(ctx.events() as readonly Event[])
  if (open.length === 0) return
  const listed = await listShells({ ctx })
  if (!listed.ok) {
    ctx.log(`shells: takeover reconcile skipped, the sandbox did not answer: ${listed.reason}`)
    return
  }
  const running = new Map(listed.value.map((info) => [info.shellId, info]))
  for (const shell of open) {
    const info = running.get(shell.shellId)
    if (info === undefined) {
      await recordQuietShellEnding({ ctx, state, shell })
      continue
    }
    if (info.status === EShellRunStatus.Running) {
      state.live.note(shell.shellId)
      continue
    }
    await recordShellEnding({
      ctx,
      state,
      frame: { kind: 'event', event: { type: 'shells.ended', shellId: shell.shellId, info } },
    })
  }
}
