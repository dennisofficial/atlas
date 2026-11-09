import { EHarnessNoticeTone, HarnessNotice } from '@dltech/atlas-ui-native'

import { ENoticeTone, type NoticeRow } from '../rows'

const toneOf = (tone: ENoticeTone): EHarnessNoticeTone => {
  if (tone === ENoticeTone.Attention) return EHarnessNoticeTone.Attention
  if (tone === ENoticeTone.Failed) return EHarnessNoticeTone.Failed
  if (tone === ENoticeTone.Ok) return EHarnessNoticeTone.Ok
  return EHarnessNoticeTone.Quiet
}

export const NoticeRowView = ({ row }: { row: NoticeRow }) => (
  <HarnessNotice title={row.title} tone={toneOf(row.tone)} body={row.body} />
)
