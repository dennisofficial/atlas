import { EEntryKind, type TranscriptEntry } from '@dltech/atlas-client/transcript'
import { settledRequestTitleOf } from '@dltech/atlas-plugin-operator/client'

export enum ENoticeTone {
  Ok = 'ok',
  Failed = 'failed',
  Attention = 'attention',
  Quiet = 'quiet',
}

const NOTICED_PREFIX = 'Atlas noticed — '

const toneOfFailed = (failed: boolean): ENoticeTone =>
  failed ? ENoticeTone.Failed : ENoticeTone.Ok

export type NoticeFields = { title: string; body: string; tone: ENoticeTone }

export function noticeFieldsOf(entry: TranscriptEntry): NoticeFields | null {
  const quiet: NoticeFields = { title: entry.text, body: '', tone: ENoticeTone.Quiet }
  switch (entry.kind) {
    case EEntryKind.SystemNotice:
      return {
        title: `${NOTICED_PREFIX}${entry.text}`,
        body: entry.content,
        tone: ENoticeTone.Quiet,
      }
    case EEntryKind.SystemContext:
    case EEntryKind.Rotated:
    case EEntryKind.OperatorInput:
    case EEntryKind.HistoryCompacted:
    case EEntryKind.TldrWritten:
      return quiet
    case EEntryKind.SandboxNotice: {
      const [title = '', ...rest] = entry.text.split('\n\n')
      return {
        title,
        body: rest.join('\n\n'),
        tone: entry.failed ? ENoticeTone.Attention : ENoticeTone.Quiet,
      }
    }
    case EEntryKind.BackgroundShellEnded:
    case EEntryKind.ServiceEnded:
      return { title: entry.text, body: entry.output, tone: toneOfFailed(entry.failed) }
    case EEntryKind.BackgroundShellAwaitingInput:
      return { title: entry.text, body: entry.output, tone: ENoticeTone.Failed }
    case EEntryKind.BackgroundShellMatched:
    case EEntryKind.BackgroundShellStillRunning:
      return { title: entry.text, body: entry.output, tone: ENoticeTone.Ok }
    case EEntryKind.AgentEnded:
      return { title: entry.text, body: entry.report, tone: toneOfFailed(entry.failed) }
    case EEntryKind.AgentReported:
      return { title: entry.text, body: entry.report, tone: ENoticeTone.Ok }
    case EEntryKind.ModelFellBack:
      return { title: entry.text, body: entry.content, tone: ENoticeTone.Attention }
    case EEntryKind.PrEvent:
      return { title: entry.text, body: entry.body, tone: toneOfFailed(entry.failed) }
    case EEntryKind.OperatorRequest:
      return entry.state === 'pending'
        ? null
        : {
            title: settledRequestTitleOf(entry.state),
            body: entry.reason ?? entry.prompt,
            tone: entry.state === 'failed' ? ENoticeTone.Failed : ENoticeTone.Quiet,
          }
    case EEntryKind.PodOom:
      return { title: entry.text, body: entry.command ?? '', tone: ENoticeTone.Failed }
    default:
      return quiet
  }
}
