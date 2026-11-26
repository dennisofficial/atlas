import type { JsonValue } from '@dltech/atlas-core'

import type { ControlTx, EffectReceiptKey } from './port'

export const onceInReceipt = async <T>(params: {
  tx: ControlTx
  receipt: EffectReceiptKey | undefined
  decode: (result: JsonValue) => T
  encode: (value: T) => JsonValue
  run: () => Promise<T>
}): Promise<T> => {
  if (params.receipt === undefined) return await params.run()
  const claim = await params.tx.claimEffectReceipt(params.receipt)
  if (claim.kind === 'replayed') return params.decode(claim.result)
  const value = await params.run()
  await params.tx.completeEffectReceipt({ ...params.receipt, result: params.encode(value) })
  return value
}
