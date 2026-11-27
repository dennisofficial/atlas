import { ETranscriptPart, type TTranscriptPart } from './gateway-protocol'
import type { ITranscript } from './transcript-model'

export const joinSpoken = ({ head, next }: { head: string; next: string }): string => {
  if (head === '') return next
  if (next === '') return head
  const needsSpace = !/[\s([{]$/.test(head) && !/^[\s.,!?;:)\]}']/.test(next)
  return needsSpace ? `${head} ${next}` : `${head}${next}`
}

export enum ESpokenSource {
  Delta = 'delta',
  Segment = 'segment',
}

export interface ISpoken extends ITranscript {
  source: ESpokenSource
}

export const EMPTY_SPOKEN: ISpoken = {
  committed: '',
  interim: '',
  source: ESpokenSource.Segment,
}

const withDelta = ({ spoken, delta }: { spoken: ISpoken; delta: string }): ISpoken => {
  if (spoken.source === ESpokenSource.Delta)
    return { source: ESpokenSource.Delta, committed: `${spoken.committed}${delta}`, interim: '' }
  return {
    source: ESpokenSource.Delta,
    committed: joinSpoken({ head: spoken.committed, next: delta }),
    interim: '',
  }
}

const withAuthoritativeText = ({ spoken, text }: { spoken: ISpoken; text: string }): ISpoken => ({
  source: ESpokenSource.Segment,
  committed: text.trim() === '' ? spoken.committed : text,
  interim: '',
})

export const withTranscriptPart = ({
  spoken,
  part,
}: {
  spoken: ISpoken
  part: TTranscriptPart
}): ISpoken => {
  switch (part.type) {
    case ETranscriptPart.Delta:
      return withDelta({ spoken, delta: part.delta })
    case ETranscriptPart.Partial:
      return { ...spoken, interim: part.text.trim() }
    case ETranscriptPart.Final:
    case ETranscriptPart.Finish:
      return withAuthoritativeText({ spoken, text: part.text })
    case ETranscriptPart.Error:
      return spoken
  }
}
