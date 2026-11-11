import type { ProviderIdentity } from '../provider'
import type { EExecutionLocation } from '../execution/location'
import type { ERunner } from '../execution/runner'
import type { EPromptGroup } from './group'

export type PromptSpawner = { sessionId: string; title: string | null }

export type PromptContext = {
  groups: readonly EPromptGroup[]
  provider: ProviderIdentity
  projectDirectory: string
  /** Where this session executes. Volatile: it is not part of promptContextKey, so a placement
   *  change recompiles without busting the cached prefix. */
  placement?: EExecutionLocation | undefined
  runner?: ERunner | undefined
  /** The session that created this one, when another session did. Volatile, for the same reason as
   *  placement: it describes the session rather than the compiled prefix. */
  spawner?: PromptSpawner | undefined
}

export function promptContextFor({
  groups,
  provider,
  projectDirectory,
  placement,
  runner,
  spawner,
}: {
  groups: readonly EPromptGroup[]
  provider: ProviderIdentity
  projectDirectory: string
  placement?: EExecutionLocation | undefined
  runner?: ERunner | undefined
  spawner?: PromptSpawner | undefined
}): PromptContext {
  return { groups, provider, projectDirectory, placement, runner, spawner }
}

export function promptContextKey({ groups, provider, projectDirectory }: PromptContext): string {
  return JSON.stringify([[...groups].sort(), provider.id, provider.modelId, projectDirectory])
}
