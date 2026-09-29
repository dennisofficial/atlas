import { PostHog } from 'posthog-node'

import { TelemetryPort, type TelemetryAgentRun, type TelemetryTurn } from '@dltech/atlas-core'

const POSTHOG_KEY = 'phc_q27hvgM8kSbwyjca72m3v7QexFE25FfFG8n529zM2WqL'
const POSTHOG_HOST = 'https://us.i.posthog.com'

type Base = { atlas_version: string }

/**
 * Every capture method forwards exactly the fields its port argument types declare — enum-ish
 * fields and counts, never text a user or a model wrote. posthog-node batches on its own timer;
 * `flush` is the HarnessApp close hook's job.
 */
export class PosthogTelemetry extends TelemetryPort {
  private readonly client: PostHog
  private readonly distinctId: string
  private readonly base: Base

  constructor(args: { distinctId: string; version: string }) {
    super()
    this.client = new PostHog(POSTHOG_KEY, { host: POSTHOG_HOST })
    this.distinctId = args.distinctId
    this.base = { atlas_version: args.version }
  }

  turnCompleted(turn: TelemetryTurn): void {
    this.capture('turn_completed', { ...turn })
  }

  featureUsed(args: { feature: string }): void {
    this.capture('feature_used', { feature: args.feature })
  }

  toolDenied(args: { tool: string; reasonClass: string }): void {
    this.capture('tool_denied', { tool: args.tool, reason_class: args.reasonClass })
  }

  agentSpawned(args: { agentType: string }): void {
    this.capture('agent_spawned', { agent_type: args.agentType })
  }

  agentEnded(run: TelemetryAgentRun): void {
    this.capture('agent_ended', {
      agent_type: run.agentType,
      status: run.status,
      turns: run.turns,
      tool_calls: run.toolCalls,
    })
  }

  exception(args: { kind: string; messageClass: string }): void {
    this.capture('$exception', { kind: args.kind, message_class: args.messageClass })
  }

  async flush(): Promise<void> {
    // shutdown() defaults to a 30s drain — a TUI exit cannot wait that long on a dead network, so
    // bound it. Events not flushed in the window are dropped with the process.
    await this.client.shutdown(2000).catch(() => undefined)
  }

  private capture(event: string, properties: Record<string, string | number>): void {
    try {
      this.client.capture({
        distinctId: this.distinctId,
        event,
        properties: { ...this.base, ...properties },
      })
    } catch {
      // Telemetry must never fault a session.
    }
  }
}
