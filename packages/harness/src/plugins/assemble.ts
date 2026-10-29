import {
  ClockPort,
  EDefinitionOrigin,
  EventLogPort,
  IdPort,
  WorkspacePort,
} from '@dltech/atlas-core'
import {
  portToken,
  registeredPortToken,
  resolveSet,
  type DependencyContainer,
} from '../container/injection'

import { installPluginApi } from './install-api'
import { loadPlugins, type LoadedPlugins, type OriginatedPlugin, type PluginIdentity } from './load'
import { registerNativePlugins } from './manifest.generated'
import { NativePlugin, type PluginHost } from './plugin'
import { readRepoPlugins } from './repo-plugins'
import type { LoadedRepoPlugin, RepoPluginRefusal } from './validate'

// `origin` is a two-member union, and TypeScript will not distribute it across the object literal,
// so a spread widens `OriginatedPlugin` instead of narrowing it. The ternary is what keeps it exact.
const originated = (entry: LoadedRepoPlugin): OriginatedPlugin =>
  entry.origin === EDefinitionOrigin.User
    ? { origin: EDefinitionOrigin.User, plugin: entry.plugin }
    : { origin: EDefinitionOrigin.Project, plugin: entry.plugin }

/**
 * A native that cannot be constructed is a binding the composition root forgot, not a plugin to be
 * quietly dropped — the same contract `worktree-tool-wiring.spec.ts` holds for tools. So this throws
 * rather than refusing, and only re-labels the failure, because tsyringe's own message names the
 * missing token but never says a plugin was what wanted it.
 */
function constructNatives(args: { container: DependencyContainer }): readonly OriginatedPlugin[] {
  try {
    return resolveSet({
      container: args.container,
      token: portToken(NativePlugin),
    }).map(
      (plugin): OriginatedPlugin => ({
        origin: EDefinitionOrigin.BuiltIn,
        plugin,
      }),
    )
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `a native plugin could not be constructed, so a dependency it injects is unbound at this point in composeAtlas: ${detail}`,
    )
  }
}

export type AssembledPlugins = LoadedPlugins & {
  unreadable: readonly RepoPluginRefusal[]
  withheld: readonly string[]
  trustKey: string
}

/**
 * Loading happens before the first `ToolRegistry` or `HookChain` resolve. Both are cached on first
 * resolve, so a plugin registered after either one is silently absent rather than late.
 */
export async function assemblePlugins(args: {
  container: DependencyContainer
  cwd: string
  atlasHome: string
  trustedRepos: string
}): Promise<AssembledPlugins> {
  installPluginApi()
  registerNativePlugins({ container: args.container })

  const natives = constructNatives({ container: args.container })
  const fromDisk = await readRepoPlugins({
    cwd: args.cwd,
    trustedRepos: args.trustedRepos,
  })

  const host = (identity: PluginIdentity): PluginHost => ({
    id: identity.id,
    origin: identity.origin,
    projectDirectory: args.cwd,
    atlasHome: args.atlasHome,
    log: args.container.resolve(registeredPortToken(EventLogPort)),
    workspace: args.container.resolve(registeredPortToken(WorkspacePort)),
    clock: args.container.resolve(registeredPortToken(ClockPort)),
    ids: args.container.resolve(registeredPortToken(IdPort)),
  })

  const loaded = await loadPlugins({
    plugins: [...natives, ...fromDisk.plugins.map(originated)],
    host,
    container: args.container,
  })

  return {
    ...loaded,
    unreadable: fromDisk.refusals,
    withheld: fromDisk.withheld,
    trustKey: fromDisk.trustKey,
  }
}
