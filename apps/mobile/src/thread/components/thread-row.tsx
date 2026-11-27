import { memo } from 'react'

import type { MessageActionHandlers } from '../message-actions'
import { ERowKind, type SessionNameOf, type ThreadRow } from '../rows'
import type { AgentLinks } from '../session/agent-links'
import { ImagesRowView } from './images-row'
import { MessageRowView } from './message-row'
import { NoticeRowView } from './notice-row'
import { WorkRowView } from './work-row'

const ThreadRowContent = ({
  row,
  threadId,
  sessionId,
  sessionNameOf,
  agentLinks,
  onOpenAgent,
  queuedLabel,
  messageActions,
}: {
  row: ThreadRow
  threadId: string | undefined
  sessionId: string | undefined
  sessionNameOf?: SessionNameOf | undefined
  agentLinks?: AgentLinks | undefined
  onOpenAgent?: ((agentId: string) => void) | undefined
  queuedLabel?: string | undefined
  messageActions?: MessageActionHandlers | undefined
}) => (
  <>
    {row.kind === ERowKind.Message ? (
      <MessageRowView
        row={row}
        threadId={threadId}
        sessionId={sessionId}
        sessionNameOf={sessionNameOf}
        queuedLabel={queuedLabel}
        messageActions={messageActions}
      />
    ) : null}
    {row.kind === ERowKind.Work ? <WorkRowView row={row} onOpenAgent={onOpenAgent} /> : null}
    {row.kind === ERowKind.Images ? <ImagesRowView row={row} sessionId={sessionId} /> : null}
    {row.kind === ERowKind.Notice ? (
      <NoticeRowView
        row={row}
        agentId={agentLinks?.byEventId.get(row.id)}
        onOpenAgent={onOpenAgent}
      />
    ) : null}
  </>
)

export const ThreadRowView = memo(ThreadRowContent)
