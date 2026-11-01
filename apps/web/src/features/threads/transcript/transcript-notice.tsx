import { ENoticeTone as EUiTone, HarnessNotice } from '@dltech/atlas-ui/ai/harness-notice'

import { ENoticeTone, type NoticeContext, type NoticeItem } from '../data/transcript-items'

const SUPERSEDED = 'superseded'

const TONE: Record<ENoticeTone, EUiTone> = {
  [ENoticeTone.Ok]: EUiTone.Ok,
  [ENoticeTone.Failed]: EUiTone.Failed,
  [ENoticeTone.Attention]: EUiTone.Attention,
  [ENoticeTone.Quiet]: EUiTone.Quiet,
}

const noteOf = (context: NoticeContext): { note?: string } => {
  if (context.note !== undefined) return { note: context.note }
  return context.superseded ? { note: SUPERSEDED } : {}
}

export function TranscriptNotice({ item }: { item: NoticeItem }) {
  return (
    <HarnessNotice
      title={item.title}
      tone={TONE[item.tone]}
      body={item.body}
      emptyNote={item.emptyNote}
      sections={item.contexts?.map((context) => ({
        id: context.id,
        label: context.label,
        content: context.content,
        ...noteOf(context),
      }))}
    />
  )
}
