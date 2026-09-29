export type TelemetryTurn = {
  status: string
  providerId: string
  modelId: string
  steps: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  durationMs: number
}

export type TelemetryAgentRun = {
  agentType: string
  status: string
  turns: number
  toolCalls: number
}

/**
 * Structured product telemetry: a handful of typed events, each carrying only enum-ish fields and
 * counts. Nothing here moves prompt text, paths, command lines, or report prose — an event that
 * needs one of those is an event the port does not offer.
 */
export abstract class TelemetryPort {
  abstract turnCompleted(turn: TelemetryTurn): void
  abstract featureUsed(args: { feature: string }): void
  abstract toolDenied(args: { tool: string; reasonClass: string }): void
  abstract agentSpawned(args: { agentType: string }): void
  abstract agentEnded(run: TelemetryAgentRun): void
  abstract exception(args: { kind: string; messageClass: string }): void
  abstract flush(): Promise<void>
}
