import type { ProviderIdentity } from '../provider'
import type { EExecutionLocation } from '../execution/location'
import type { ERunner } from '../execution/runner'
import type { EPromptGroup } from './group'

export type PromptContext = {
  groups: readonly EPromptGroup[]
  provider: ProviderIdentity
  projectDirectory: string
  /** Where this session executes. Volatile: it is not part of promptContextKey, so a placement
   *  change recompiles without busting the cached prefix. */
  placement?: EExecutionLocation | undefined
  runner?: ERunner | undefined
}

export function promptContextFor({
  groups,
  provider,
  projectDirectory,
  placement,
  runner,
}: {
  groups: readonly EPromptGroup[]
  provider: ProviderIdentity
  projectDirectory: string
  placement?: EExecutionLocation | undefined
  runner?: ERunner | undefined
}): PromptContext {
  return { groups, provider, projectDirectory, placement, runner }
}

export function promptContextKey({ groups, provider, projectDirectory }: PromptContext): string {
  return JSON.stringify([[...groups].sort(), provider.id, provider.modelId, projectDirectory])
}
