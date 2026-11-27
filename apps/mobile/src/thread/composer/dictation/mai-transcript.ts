import { ETranscriptPart, type TTranscriptPart } from './gateway-protocol'
import type { ITranscript } from './transcript-model'

export const joinSpoken = ({ head, next }: { head: string; next: string }): string => {
  if (head === '') return next
  if (next === '') return head
  const needsSpace = !/[\s([{]$/.test(head) && !/^[\s.,!?;:)\]}']/.test(next)
  return needsSpace ? `${head} ${next}` : `${head}${next}`
}

const mergedFinalOf = ({ committed, next }: { committed: string; next: string }): string => {
  const trimmed = next.trim()
  if (committed === '') return trimmed
  if (trimmed === '') return committed
  if (trimmed.startsWith(committed)) return trimmed
  if (committed.startsWith(trimmed)) return committed
  return joinSpoken({ head: committed, next: trimmed })
}

export const EMPTY_SPOKEN: ITranscript = { committed: '', interim: '' }

export const withTranscriptPart = ({
  transcript,
  part,
}: {
  transcript: ITranscript
  part: TTranscriptPart
}): ITranscript => {
  switch (part.type) {
    case ETranscriptPart.Delta:
      return {
        committed: joinSpoken({ head: transcript.committed, next: part.delta }),
        interim: '',
      }
    case ETranscriptPart.Partial:
      return { committed: transcript.committed, interim: part.text.trim() }
    case ETranscriptPart.Final:
    case ETranscriptPart.Finish:
      return {
        committed: mergedFinalOf({ committed: transcript.committed, next: part.text }),
        interim: '',
      }
    case ETranscriptPart.Error:
      return transcript
  }
}
