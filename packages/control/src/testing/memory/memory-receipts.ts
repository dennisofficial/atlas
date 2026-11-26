import type { JsonValue } from '@dltech/atlas-core'

import type { EffectReceiptClaim, EffectReceiptKey } from '../../port'
import type { State } from './memory-state'

const receiptKeyOf = (params: EffectReceiptKey): string => `${params.threadId}:${params.stepKey}`

export const claimEffectReceiptIn = (
  params: EffectReceiptKey & { state: State },
): EffectReceiptClaim => {
  const key = receiptKeyOf(params)
  const entry = params.state.effectReceipts.get(key)
  if (entry === undefined) {
    params.state.effectReceipts.set(key, 'claimed')
    return { kind: 'claimed' }
  }
  if (entry === 'claimed') {
    throw new Error(`effect receipt ${params.stepKey} was claimed but never completed`)
  }
  return { kind: 'replayed', result: entry.result }
}

export const completeEffectReceiptIn = (
  params: EffectReceiptKey & { state: State; result: JsonValue },
): void => {
  params.state.effectReceipts.set(receiptKeyOf(params), { result: params.result })
}
