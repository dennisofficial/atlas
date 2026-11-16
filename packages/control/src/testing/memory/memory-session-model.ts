import { refKey, type ModelChoice } from '@dltech/atlas-core'
import { sessionModelOf, type SessionModelAsk } from '@dltech/atlas-models'

import type { SessionModelRow } from '../../port'

export const resolveSessionModelIn = (params: {
  ask: SessionModelAsk
  current?: ModelChoice | undefined
}): SessionModelRow => {
  const choice = sessionModelOf({
    settings: new Map(),
    accounts: [],
    activeAccounts: [],
    ask: params.ask,
    ...(params.current === undefined ? {} : { current: params.current }),
  })
  return { modelRef: refKey(choice.ref), modelEffort: choice.effort, modelFast: choice.fast }
}

export const setSessionModelIn = (params: {
  row: { modelRef: string; modelEffort: string; modelFast: boolean }
  model: SessionModelRow
}): void => {
  params.row.modelRef = params.model.modelRef
  params.row.modelEffort = params.model.modelEffort
  params.row.modelFast = params.model.modelFast
}
