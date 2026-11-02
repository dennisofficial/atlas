import {
  createSettlePending as createAgentSettlePending,
  type OnToolOutputNotice,
  type SettlePending,
  type ToolOutputNotice,
} from '@dltech/atlas-agent'
import type { EventLogPort } from '@dltech/atlas-core'

import { eventLogAgentRecord } from './event-log-agent-record'

export type { OnToolOutputNotice, SettlePending, ToolOutputNotice }

export const createSettlePending = ({
  log,
  ...rest
}: Omit<Parameters<typeof createAgentSettlePending>[0], 'record'> & {
  log: EventLogPort
}): SettlePending =>
  createAgentSettlePending({
    ...rest,
    record: eventLogAgentRecord(log).record,
  })
