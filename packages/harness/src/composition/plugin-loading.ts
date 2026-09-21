import { ENoticeTone, NOTICE_WARN_MS, type NoticePort } from '@dltech/atlas-core'

import type { DependencyContainer } from '../container/injection'
import { assemblePlugins, type AssembledPlugins } from '../plugins/assemble'

/**
 * Every plugin contribution — native and repo, hooks and tools and prompt fragments — has to
 * register before `ToolRegistry`/`HookChain` first resolve, and before `surface.bind` runs, so a
 * serve session gets exactly what the TUI gets rather than reading it back from `surface.bind`.
 */
export async function loadSessionPlugins(args: {
  container: DependencyContainer
  cwd: string
  atlasHome: string
  notice: NoticePort
}): Promise<AssembledPlugins> {
  const plugins = await assemblePlugins({
    container: args.container,
    cwd: args.cwd,
    atlasHome: args.atlasHome,
  })

  for (const refusal of [...plugins.refused, ...plugins.unreadable]) {
    args.notice.notify({
      key: `plugin:${refusal.id ?? '?'}`,
      tone: ENoticeTone.Warn,
      ttlMs: NOTICE_WARN_MS,
      text: `plugin refused: ${refusal.id ?? '?'} — ${'reason' in refusal ? refusal.reason : refusal.detail}`,
    })
  }

  return plugins
}
