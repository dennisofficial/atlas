import {
  TelemetryPort,
  type ActiveWorktree,
  type Event,
  type EventDraft,
  type OnToolOutput,
} from '@dltech/atlas-core'

import { ToolDispatcher, type DispatchableCall } from '../tools/dispatch'

import { featureForTool } from './feature-tools'
import { reasonClassOf } from './reason-class'

/**
 * Wraps whichever dispatcher the container built, so main-loop and sub-agent dispatches report
 * identically. Observes drafts only; the denial draft is what carries a refusal, so a deny is
 * counted when it comes back, never by intercepting the policy.
 */
export class ObservingToolDispatcher extends ToolDispatcher {
  private readonly inner: ToolDispatcher
  private readonly telemetry: TelemetryPort | undefined

  constructor(args: { inner: ToolDispatcher; telemetry?: TelemetryPort | undefined }) {
    super()
    this.inner = args.inner
    this.telemetry = args.telemetry
  }

  async dispatch(args: {
    call: DispatchableCall
    signal: AbortSignal
    projectDirectory: string
    homeDirectory?: string | undefined
    events: readonly Event[]
    activeWorktree?: ActiveWorktree | undefined
    onOutput?: OnToolOutput | undefined
  }): Promise<readonly EventDraft[]> {
    const drafts = await this.inner.dispatch(args)

    for (const draft of drafts) {
      if (draft.type === 'tool-denied') {
        this.telemetry?.toolDenied({
          tool: args.call.name,
          reasonClass: reasonClassOf(draft.reason),
        })
      }

      if (draft.type === 'tool-result' && draft.error === undefined) {
        const feature = featureForTool(args.call.name)
        if (feature !== undefined) this.telemetry?.featureUsed({ feature })
      }
    }

    return drafts
  }
}

export type { DispatchableCall }
