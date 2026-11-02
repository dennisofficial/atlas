import { AgentRecordPort, ModelContextPort } from '@dltech/atlas-agent'
import type { EventLogPort } from '@dltech/atlas-core'

export class EventLogAgentRecord extends AgentRecordPort {
  constructor(private readonly log: EventLogPort) {
    super()
  }

  append: AgentRecordPort['append'] = (args) => this.log.append(args)

  ownEvents: AgentRecordPort['ownEvents'] = ({ threadId, afterSeq }) =>
    this.log.readOwn({ threadId, ...(afterSeq === undefined ? {} : { fromSeq: afterSeq }) })

  composedEvents: AgentRecordPort['composedEvents'] = ({ threadId }) => this.log.read({ threadId })
}

class EventLogModelContext extends ModelContextPort {
  constructor(private readonly log: EventLogPort) {
    super()
  }

  read: ModelContextPort['read'] = async ({ threadId }) => ({
    events: await this.log.read({ threadId }),
  })
}

export const eventLogAgentRecord = (
  log: EventLogPort,
): { record: AgentRecordPort; modelContext: ModelContextPort } => ({
  record: new EventLogAgentRecord(log),
  modelContext: new EventLogModelContext(log),
})
