import { ENoticeTone as EUiTone, HarnessNotice } from '@dltech/atlas-ui/ai/harness-notice'

import {
  ENoticeAction,
  ENoticeTone,
  type NoticeContext,
  type NoticeItem,
} from '../data/transcript-items'

const SUPERSEDED = 'superseded'

const TONE: Record<ENoticeTone, EUiTone> = {
  [ENoticeTone.Ok]: EUiTone.Ok,
  [ENoticeTone.Failed]: EUiTone.Failed,
  [ENoticeTone.Attention]: EUiTone.Attention,
  [ENoticeTone.Quiet]: EUiTone.Quiet,
}

const ACTION_LABEL: Record<ENoticeAction, string> = {
  [ENoticeAction.ChangePodSize]: 'Change pod size',
}

const noteOf = (context: NoticeContext): { note?: string } => {
  if (context.note !== undefined) return { note: context.note }
  return context.superseded ? { note: SUPERSEDED } : {}
}

function actionOf(args: {
  item: NoticeItem
  onChangePodSize: (() => void) | null
}): { label: string; onClick: () => void } | undefined {
  const action = args.item.action
  if (action === undefined || args.onChangePodSize === null) return undefined
  return { label: ACTION_LABEL[action], onClick: args.onChangePodSize }
}

export function TranscriptNotice({
  item,
  onChangePodSize,
}: {
  item: NoticeItem
  onChangePodSize?: (() => void) | null
}) {
  const action = actionOf({ item, onChangePodSize: onChangePodSize ?? null })
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
      {...(action === undefined ? {} : { action })}
    />
  )
}
