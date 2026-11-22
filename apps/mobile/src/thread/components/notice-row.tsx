import { EHarnessNoticeTone, HarnessNotice } from '@dltech/atlas-ui-native'

import { ENoticeTone, type NoticeRow } from '../rows'
import { AgentOpenLink } from './agent-open-link'

const toneOf = (tone: ENoticeTone): EHarnessNoticeTone => {
  if (tone === ENoticeTone.Attention) return EHarnessNoticeTone.Attention
  if (tone === ENoticeTone.Failed) return EHarnessNoticeTone.Failed
  if (tone === ENoticeTone.Ok) return EHarnessNoticeTone.Ok
  return EHarnessNoticeTone.Quiet
}

export const NoticeRowView = ({
  row,
  agentId,
  onOpenAgent,
}: {
  row: NoticeRow
  agentId?: string | undefined
  onOpenAgent?: ((agentId: string) => void) | undefined
}) => {
  const handleOpenAgent = () => {
    if (agentId === undefined || onOpenAgent === undefined) return
    onOpenAgent(agentId)
  }

  return (
    <>
      <HarnessNotice title={row.title} tone={toneOf(row.tone)} body={row.body} />
      {agentId === undefined || onOpenAgent === undefined ? null : (
        <AgentOpenLink onPress={handleOpenAgent} />
      )}
    </>
  )
}
