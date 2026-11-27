export interface IInsertion {
  text: string
  cursor: number
}

export const insertionOf = ({
  before,
  spoken,
  after,
}: {
  before: string
  spoken: string
  after: string
}): IInsertion => {
  if (spoken === '') return { text: `${before}${after}`, cursor: before.length }
  const lead = before === '' || /\s$/.test(before) ? '' : ' '
  const trail = after === '' || /^[\s.,!?;:)\]}']/.test(after) ? '' : ' '
  return {
    text: `${before}${lead}${spoken}${trail}${after}`,
    cursor: before.length + lead.length + spoken.length,
  }
}
