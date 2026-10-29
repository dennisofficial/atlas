import { ETranscriptKind, type ToolCallItem, type TranscriptItem } from './transcript-items'

const isSameCall = (previous: ToolCallItem, next: ToolCallItem): boolean =>
  previous.id === next.id &&
  previous.kind === next.kind &&
  previous.state === next.state &&
  previous.label === next.label &&
  previous.title === next.title &&
  previous.family === next.family &&
  previous.path === next.path &&
  previous.at === next.at &&
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
  if (previous.text !== next.text) return false
  if (next.kind === ETranscriptKind.User || previous.kind === ETranscriptKind.User)
    return (
      previous.kind === ETranscriptKind.User &&
      next.kind === ETranscriptKind.User &&
      previous.images === next.images
    )
  if (previous.kind === ETranscriptKind.Thought && next.kind === ETranscriptKind.Thought) {
    if (previous.heldOpen !== next.heldOpen) return false
  }
  return previous.streaming === next.streaming
}
