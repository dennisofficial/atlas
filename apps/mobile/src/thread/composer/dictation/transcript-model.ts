export interface ITranscript {
  committed: string
  interim: string
}

export const EMPTY_TRANSCRIPT: ITranscript = { committed: '', interim: '' }

export const joinWords = ({ head, word }: { head: string; word: string }): string => {
  const next = word.trim()
  if (next === '') return head
  if (head === '') return next
  return `${head} ${next}`
}

export const applyPartialOf = ({
  transcript,
  partial,
}: {
  transcript: ITranscript
  partial: string
}): ITranscript => ({ committed: transcript.committed, interim: partial.trim() })

export const applyFinalOf = ({
  transcript,
  final,
}: {
  transcript: ITranscript
  final: string
}): ITranscript => ({
  committed: joinWords({ head: transcript.committed, word: final }),
  interim: '',
})

export const transcriptTextOf = (transcript: ITranscript): string =>
  joinWords({ head: transcript.committed, word: transcript.interim })

export const transcriptKeyOf = (transcript: ITranscript): string =>
  `${transcript.committed}\u0000${transcript.interim}`
