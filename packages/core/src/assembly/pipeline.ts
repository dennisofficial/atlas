import { cacheBreakpoints } from './annotators/cache-breakpoints'
import { INFERENCE_PROVIDER_ID, requestCacheKey } from './annotators/request-cache-key'
import type { Annotator, Rule } from './rule'
import { agentEndingsBlock } from './rules/agent-endings-block'
import { capabilitiesBlock, type CapabilitiesSource } from './rules/capabilities-block'
import { compactedHistory } from './rules/compacted-history'
import {
  executionLocationBlock,
  type ExecutionLocationSource,
} from './rules/execution-location-block'
import { imagesInContext } from './rules/images'
import { messagesFromEvents } from './rules/messages-from-events'
import { runningAgentsBlock, type RunningAgentsSource } from './rules/running-agents-block'
import { runningServicesBlock, type RunningServicesSource } from './rules/running-services-block'
import { runningShellsBlock, type RunningShellsSource } from './rules/running-shells-block'
import { systemPrompt, type PromptSource } from './rules/system-prompt'
import { worktreeBlock } from './rules/worktree-block'

export type AssemblyPipeline = {
  rules: readonly Rule[]
  annotators: readonly Annotator[]
}

export function defaultRules({
  prompt,
  launchDirectory,
  repoRoot,
  runningShells,
  runningServices,
  runningAgents,
  executionLocation,
  capabilities,
}: {
  prompt: PromptSource
  launchDirectory: string
  repoRoot?: string | undefined
  runningShells?: RunningShellsSource | undefined
  runningServices?: RunningServicesSource | undefined
  runningAgents?: RunningAgentsSource | undefined
  executionLocation?: ExecutionLocationSource | undefined
  capabilities?: CapabilitiesSource | undefined
}): readonly Rule[] {
  return [
    systemPrompt({ prompt, launchDirectory }),
    messagesFromEvents(),
    agentEndingsBlock(),
    compactedHistory(),
    imagesInContext(),
    worktreeBlock({ launchDirectory, repoRoot }),
    ...(executionLocation === undefined ? [] : [executionLocationBlock({ executionLocation })]),
    ...(capabilities === undefined ? [] : [capabilitiesBlock({ capabilities })]),
    ...(runningShells === undefined ? [] : [runningShellsBlock({ runningShells })]),
    ...(runningServices === undefined ? [] : [runningServicesBlock({ runningServices })]),
    ...(runningAgents === undefined ? [] : [runningAgentsBlock({ runningAgents })]),
  ]
}

export function defaultAnnotators(): readonly Annotator[] {
  return [
    cacheBreakpoints(),
    requestCacheKey(),
    requestCacheKey({ providerId: INFERENCE_PROVIDER_ID, optionKey: 'prompt_cache_key' }),
  ]
}

export function defaultPipeline({
  prompt,
  launchDirectory,
  repoRoot,
  runningShells,
  runningServices,
  runningAgents,
  executionLocation,
  capabilities,
}: {
  prompt: PromptSource
  launchDirectory: string
  repoRoot?: string | undefined
  runningShells?: RunningShellsSource | undefined
  runningServices?: RunningServicesSource | undefined
  runningAgents?: RunningAgentsSource | undefined
  executionLocation?: ExecutionLocationSource | undefined
  capabilities?: CapabilitiesSource | undefined
}): AssemblyPipeline {
  return {
    rules: defaultRules({
      prompt,
      launchDirectory,
      repoRoot,
      runningShells,
      runningServices,
      runningAgents,
      executionLocation,
      capabilities,
    }),
    annotators: defaultAnnotators(),
  }
}
