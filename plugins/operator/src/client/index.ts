import type { ClientSlot } from '@dltech/atlas-plugin-sdk'

import { operatorRequestEntries } from './request-entry'

export { pendingOperatorRequestOf } from './pending-request'
export { answerRefusalOf, settledRequestTitleOf } from './request-copy'
export { operatorRequestEntries, requestEntriesAt } from './request-entry'

export const operatorClient: ClientSlot = {
  hooks: [],
  entryFolds: [operatorRequestEntries],
}
