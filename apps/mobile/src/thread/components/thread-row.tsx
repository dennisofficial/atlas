import { ERowKind, type SessionNameOf, type ThreadRow } from '../rows'
import type { AgentLinks } from '../v2/agent-links'
import { MessageRowView, type QueuedMessageActions } from './message-row'
import { NoticeRowView } from './notice-row'
import { WorkRowView } from './work-row'

export const ThreadRowView = ({
  row,
  threadId,
  sessionId,
  sessionNameOf,
  agentLinks,
  onOpenAgent,
  queued,
}: {
  row: ThreadRow
  threadId: string | undefined
  sessionId: string | undefined
  sessionNameOf?: SessionNameOf | undefined
  agentLinks?: AgentLinks | undefined
  onOpenAgent?: ((agentId: string) => void) | undefined
  queued?: QueuedMessageActions | undefined
}) => (
  <>
    {row.kind === ERowKind.Message ? (
      <MessageRowView
        row={row}
        threadId={threadId}
        sessionId={sessionId}
        {...(sessionNameOf === undefined ? {} : { sessionNameOf })}
        {...(queued === undefined ? {} : { queued })}
      />
    ) : null}
    {row.kind === ERowKind.Work ? <WorkRowView row={row} onOpenAgent={onOpenAgent} /> : null}
    {row.kind === ERowKind.Notice ? (
      <NoticeRowView
        row={row}
        {...(agentLinks === undefined ? {} : { agentId: agentLinks.byEventId.get(row.id) })}
        {...(onOpenAgent === undefined ? {} : { onOpenAgent })}
      />
    ) : null}
  </>
)
