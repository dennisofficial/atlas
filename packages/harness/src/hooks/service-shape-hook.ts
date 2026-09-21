import {
  BeforeToolHook,
  EBeforeToolDecision,
  EStage,
  JEV_SERVICE_KEY,
  jevServiceQuestions,
  serverShapeSuspected,
  type BeforeTool,
  type BeforeToolOutcome,
  type DecisionPort,
  type HookOrder,
  type ToolCall,
} from '@dltech/atlas-core'

export const SERVICE_SHAPE_THRESHOLD = 0.25

const TEACHING = [
  'run it with service_start instead — a service keeps its logs, never times out, and outlives the turn.',
  'If this command really does its work and exits, say why and run it again.',
].join(' ')

const allowing = (call: ToolCall): BeforeToolOutcome => ({
  decision: EBeforeToolDecision.Allow,
  input: call.input,
})

const commandOf = (call: ToolCall): string | undefined => {
  if (typeof call.input !== 'object' || call.input === null) return undefined
  const command = (call.input as Record<string, unknown>)['command']
  return typeof command === 'string' ? command : undefined
}

export class ServiceShapeHook extends BeforeToolHook {
  readonly name = 'serviceShape'
  readonly order: HookOrder = { stage: EStage.Policy, nudge: 1 }

  private readonly decisions: DecisionPort

  constructor(deps: { decisions: DecisionPort }) {
    super()
    this.decisions = deps.decisions
  }

  readonly run: BeforeTool = async ({ call, signal }) => {
    if (call.name !== 'bash') return allowing(call)

    const command = commandOf(call)
    if (command === undefined || !serverShapeSuspected(command)) return allowing(call)

    const outcome = await this.decisions.decide({
      state: `the command as it was written:\n${command}`,
      questions: jevServiceQuestions(),
      signal,
    })
    if (!outcome.ok) return allowing(call)

    const probability = outcome.answers[JEV_SERVICE_KEY]?.noul
    if (probability === undefined || probability < SERVICE_SHAPE_THRESHOLD) return allowing(call)

    return {
      decision: EBeforeToolDecision.Deny,
      reason: `the decision model scored this command starting a long-lived process at ${probability.toFixed(2)}: ${TEACHING}`,
    }
  }
}
