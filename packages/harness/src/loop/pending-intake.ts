import {
  appendPending as appendAgentPending,
  type DrainedPending,
  type PendingDrain,
} from '@dltech/atlas-agent-v1'
import type { EventLogPort } from '@dltech/atlas-core'

import { eventLogAgentRecord } from './event-log-agent-record'

export type { DrainedPending, PendingDrain }

export const appendPending = ({
  log,
  ...rest
}: Omit<Parameters<typeof appendAgentPending>[0], 'record'> & {
  log: EventLogPort
}): Promise<DrainedPending> =>
  appendAgentPending({ ...rest, record: eventLogAgentRecord(log).record })
