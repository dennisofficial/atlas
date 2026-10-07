import type { ModelPort } from '@dltech/atlas-core'

import { isTeammateType, type AgentType } from './agent-type'

export type PinnedModelBuild = (args: { modelId: string }) => ModelPort

export type AgentModelSource = (args: { agentType: AgentType }) => ModelPort

export function pinnedModelSource(args: {
  inherited: () => ModelPort
  build: PinnedModelBuild
  subagentModelId?: (() => string | undefined) | undefined
  typeModelId?: ((typeName: string) => string | undefined) | undefined
}): AgentModelSource {
  return ({ agentType }) => {
    const modelId =
      args.typeModelId?.(agentType.name) ??
      agentType.model ??
      (isTeammateType(agentType.name) ? undefined : args.subagentModelId?.())
    return modelId === undefined ? args.inherited() : args.build({ modelId })
  }
}
