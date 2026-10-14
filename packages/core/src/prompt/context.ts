import type { ProviderIdentity } from '../provider'
import type { EExecutionLocation } from '../execution/location'
import type { EPromptAgent } from './agent'
import type { PromptModel } from './model'

export type PromptContext = {
  agent: EPromptAgent
  provider: ProviderIdentity
  model: PromptModel
  projectDirectory: string
  /** Where this session executes. Volatile: it is not part of promptContextKey, so a placement
   *  change recompiles without busting the cached prefix. */
  placement?: EExecutionLocation | undefined
}

export function promptContextFor({
  agent,
  provider,
  model,
  projectDirectory,
  placement,
}: {
  agent: EPromptAgent
  provider: ProviderIdentity
  model: PromptModel
  projectDirectory: string
  placement?: EExecutionLocation | undefined
}): PromptContext {
  return { agent, provider, model, projectDirectory, placement }
}

export function promptContextKey({ agent, provider, projectDirectory }: PromptContext): string {
  return JSON.stringify([agent, provider.id, provider.modelId, projectDirectory])
}
