import type { ModelPort } from '@dltech/atlas-core'

import type { AgentType } from './agent-type'

export type PinnedModelBuild = (args: { modelId: string }) => ModelPort

export type AgentModelSource = (args: { agentType: AgentType }) => ModelPort

/**
 * Four voices may name a sub-agent's model, in the order a choice gets less specific: the type's
 * own row in settings, a model the type's definition pins, the sub-agent role row, and — when none
 * spoke — whatever the parent conversation is running on. All three pins re-read per spawn, so a
 * settings change reaches the next child rather than the next launch.
 */
export function pinnedModelSource(args: {
  inherited: () => ModelPort
  build: PinnedModelBuild
  subagentModelId?: (() => string | undefined) | undefined
  typeModelId?: ((typeName: string) => string | undefined) | undefined
}): AgentModelSource {
  return ({ agentType }) => {
    const modelId =
      args.typeModelId?.(agentType.name) ?? agentType.model ?? args.subagentModelId?.()
    return modelId === undefined ? args.inherited() : args.build({ modelId })
  }
}
