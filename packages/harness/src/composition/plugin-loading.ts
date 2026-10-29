import {
  ENoticeTone,
  ESettingId,
  NOTICE_WARN_MS,
  type NoticePort,
  type SettingsDocument,
} from '@dltech/atlas-core'

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
  trustedRepos: string
}): Promise<AssembledPlugins> {
  const plugins = await assemblePlugins({
    container: args.container,
    cwd: args.cwd,
    atlasHome: args.atlasHome,
    trustedRepos: args.trustedRepos,
  })

  for (const refusal of [...plugins.refused, ...plugins.unreadable]) {
    args.notice.notify({
      key: `plugin:${refusal.id ?? '?'}`,
      tone: ENoticeTone.Warn,
      ttlMs: NOTICE_WARN_MS,
      text: `plugin refused: ${refusal.id ?? '?'} — ${'reason' in refusal ? refusal.reason : refusal.detail}`,
    })
  }

  if (plugins.withheld.length > 0) {
    args.notice.notify({
      key: 'plugin:untrusted',
      tone: ENoticeTone.Warn,
      ttlMs: NOTICE_WARN_MS,
      text: `project plugins not loaded: ${plugins.withheld.join(', ')} — add ${plugins.trustKey} to Trusted repositories in settings (plugins.trustedRepos), then start a new session`,
    })
  }

  return plugins
}

export const userTrustedRepos = (document: SettingsDocument): string => {
  const held = document.values[ESettingId.TrustedRepos]
  return typeof held === 'string' ? held : ''
}
