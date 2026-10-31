import type { ERiskDimension } from '../policy/classifier/dimension'
import type { EGrantScope, GrantOffer } from '../policy/classifier/grant'
import type { EClassifierMode, ETriage } from '../policy/classifier/triage'
import type { EJudgment, EVerdictFault } from '../policy/classifier/verdict'
import type { CallId } from './ids'

export type PolicyEventBody =
  | {
      type: 'classifier-judged'
      callId: CallId
      mode: EClassifierMode
      triage: ETriage
      judgment: EJudgment
      dimensions: readonly ERiskDimension[]
      judgedDimension?: ERiskDimension | undefined
      verdictFault?: EVerdictFault | undefined
      judgeFault?: string | undefined
      signalIds: readonly string[]
      details?: readonly string[] | undefined
      grantables?: readonly GrantOffer[] | undefined
      reason: string
      consulted: boolean
      wouldAsk?: boolean | undefined
      elapsedMs: number
    }
  | {
      type: 'permission-granted'
      grantId: string
      dimensions: readonly ERiskDimension[]
      scope: EGrantScope
      subject: string
      reason: string
    }
