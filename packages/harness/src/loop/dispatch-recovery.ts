import {
  crashedCallDraft,
  settleCrashedCalls as settleAgentCrashedCalls,
  type ToolEffectResolver,
} from '@dltech/atlas-agent-v1'
import type { EventLogPort } from '@dltech/atlas-core'

export { crashedCallDraft, type ToolEffectResolver }

export const settleCrashedCalls = ({
  log,
  ...rest
}: Omit<Parameters<typeof settleAgentCrashedCalls>[0], 'record'> & {
  log: Pick<EventLogPort, 'readOwn' | 'append'>
}) =>
  settleAgentCrashedCalls({
    ...rest,
    record: {
      append: (args) => log.append(args),
      ownEvents: ({ threadId }) => log.readOwn({ threadId }),
    },
  })
