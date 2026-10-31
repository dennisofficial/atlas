import { providerLabelOf } from '../credentials/providers'
import { ERunFailureKind, remediesOf, type ERunRemedy, type RunFailure } from './run-failure'

export type RunFailureCopy = {
  title: string
  detail: string
  remedies: readonly ERunRemedy[]
}

export { providerLabelOf }

const FALLBACK_PROVIDER = 'the provider'
const FALLBACK_ACCOUNT = 'this account'

type Words = { title: string; detail: string }

function wordsOf(args: {
  failure: RunFailure
  provider: string
  subject: string
  account: string
}): Words {
  const { failure, provider, subject, account } = args
  switch (failure.kind) {
    case ERunFailureKind.Auth:
      return {
        title: `${subject} rejected the API key`,
        detail: `${subject} rejected the API key for ${account}. Update it in Settings → Providers, then retry.`,
      }
    case ERunFailureKind.Quota:
      return {
        title: `${account === FALLBACK_ACCOUNT ? subject : account} is out of credits`,
        detail: `${subject} reports no remaining credits or quota for ${account}. Top up in Settings → Providers or switch model, then retry.`,
      }
    case ERunFailureKind.MissingCredential:
      return {
        title: `No ${provider} key available`,
        detail: `Atlas has no usable credential for ${provider}. Add or refresh one in Settings → Providers (or /auth), then retry.`,
      }
    case ERunFailureKind.RateLimited:
      return {
        title: `${subject} rate limited the run`,
        detail: `${subject} is rate limiting requests for ${account}. Wait a moment and retry, or switch model.`,
      }
    case ERunFailureKind.Network:
      return {
        title: `Couldn't reach ${provider}`,
        detail: `The connection to ${provider} dropped before the run finished. Check your network, then retry.`,
      }
    case ERunFailureKind.Stalled:
      return {
        title: `${subject} stopped responding`,
        detail: `The reply from ${provider} went silent mid-stream and Atlas gave up waiting. Retry the run.`,
      }
    case ERunFailureKind.Overloaded:
      return {
        title: `${subject} is overloaded`,
        detail: `${subject} is overloaded right now. Retry in a moment or switch model.`,
      }
    case ERunFailureKind.ContextOverflow:
      return {
        title: 'The conversation is too long',
        detail:
          "This conversation no longer fits the model's context window. Compact it to summarise the older turns, or switch to a model with a larger window.",
      }
    case ERunFailureKind.ExchangeFault:
      return {
        title: 'Atlas built an invalid prompt',
        detail: `Atlas refused to send a prompt it could not make consistent: ${failure.message} Retry the run; if it repeats, report it.`,
      }
    case ERunFailureKind.LoopGuard:
      return {
        title: 'The run was stopped for looping',
        detail:
          'The agent kept repeating the same calls with the same results even after its context was rewound. Retry with a clearer instruction.',
      }
    case ERunFailureKind.ToolSettlement:
      return {
        title: 'A tool call never settled',
        detail: `A tool call was left without a result, so the run could not continue: ${failure.message} Retry the run; if it repeats, report it.`,
      }
    case ERunFailureKind.FinishFault:
      return {
        title: `${subject} ended the reply early`,
        detail: `${subject} ended the reply with an error, a safety filter or an empty answer: ${failure.message} Retry, rephrase the request, or switch model.`,
      }
    case ERunFailureKind.AgentFailed: {
      const { agent } = failure
      const name = agent === undefined ? 'A sub-agent' : `The ${agent.agentType} sub-agent`
      const task = agent === undefined || agent.intent === '' ? '' : ` (${agent.intent})`
      return {
        title: agent === undefined ? 'A sub-agent failed' : `${agent.agentType} failed`,
        detail: `${name}${task} failed: ${failure.message} Open it to see why.`,
      }
    }
    case ERunFailureKind.Crashed:
      return {
        title: 'The run crashed',
        detail: `Atlas hit an unexpected error and stopped the run: ${failure.message} Retry; if it repeats, report it.`,
      }
    case ERunFailureKind.Other:
      return { title: 'The run failed', detail: failure.message }
  }
}

export function runFailureCopy(args: {
  failure: RunFailure
  providerLabel?: string | undefined
  accountLabel?: string | undefined
}): RunFailureCopy {
  const { failure } = args
  const provider = args.providerLabel ?? providerLabelOf(failure.providerId) ?? FALLBACK_PROVIDER
  const account = args.accountLabel ?? FALLBACK_ACCOUNT
  const subject = provider === FALLBACK_PROVIDER ? 'The provider' : provider
  return { ...wordsOf({ failure, provider, subject, account }), remedies: remediesOf(failure.kind) }
}
