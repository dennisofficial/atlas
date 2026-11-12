import { ETranscriptKind, type ToolCallItem, type TranscriptItem } from './transcript-items'

const isSameCall = (previous: ToolCallItem, next: ToolCallItem): boolean =>
  previous.id === next.id &&
  previous.kind === next.kind &&
  previous.state === next.state &&
  previous.label === next.label &&
  previous.title === next.title &&
  previous.family === next.family &&
  previous.path === next.path &&
  previous.image?.id === next.image?.id &&
  previous.at === next.at &&
  previous.settledAt === next.settledAt &&
  previous.output === next.output &&
  previous.errorText === next.errorText &&
  previous.elapsed === next.elapsed

export function isSameItem(args: { previous: TranscriptItem; next: TranscriptItem }): boolean {
  const { previous, next } = args
  if (previous === next) return true
  if (previous.kind !== next.kind || previous.id !== next.id || previous.at !== next.at)
    return false
  if (next.kind === ETranscriptKind.Tools) {
    if (previous.kind !== ETranscriptKind.Tools) return false
    return (
      previous.calls.length === next.calls.length &&
      previous.calls.every((call, index) => {
        const other = next.calls[index]
        return other !== undefined && isSameCall(call, other)
      })
    )
  }
  if (previous.kind === ETranscriptKind.Tools) return false
  if (next.kind === ETranscriptKind.SignIn || previous.kind === ETranscriptKind.SignIn)
    return (
      previous.kind === ETranscriptKind.SignIn &&
      next.kind === ETranscriptKind.SignIn &&
      previous.text === next.text &&
      previous.result === next.result &&
      previous.reason === next.reason
    )
  if (next.kind === ETranscriptKind.Request || previous.kind === ETranscriptKind.Request)
    return (
      previous.kind === ETranscriptKind.Request &&
      next.kind === ETranscriptKind.Request &&
      previous.state === next.state &&
      previous.prompt === next.prompt &&
      previous.path === next.path &&
      previous.bytes === next.bytes &&
      previous.reason === next.reason
    )
  if (next.kind === ETranscriptKind.Notice || previous.kind === ETranscriptKind.Notice)
    return (
      previous.kind === ETranscriptKind.Notice &&
      next.kind === ETranscriptKind.Notice &&
      previous.title === next.title &&
      previous.body === next.body &&
      previous.tone === next.tone &&
      previous.contexts === next.contexts
    )
  if (previous.text !== next.text) return false
  if (next.kind === ETranscriptKind.User || previous.kind === ETranscriptKind.User)
    return (
      previous.kind === ETranscriptKind.User &&
      next.kind === ETranscriptKind.User &&
      previous.attachments === next.attachments
    )
  if (previous.kind === ETranscriptKind.Thought && next.kind === ETranscriptKind.Thought) {
    if (previous.heldOpen !== next.heldOpen) return false
  }
  if (previous.kind === ETranscriptKind.Agent && next.kind === ETranscriptKind.Agent) {
    if (previous.fast !== next.fast) return false
  }
  return previous.streaming === next.streaming
}
