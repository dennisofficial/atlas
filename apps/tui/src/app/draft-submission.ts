import type { LiveToken } from '../ui/composer-tokens'
import type { DraftImage } from '../ui/draft-images'

export type DraftSubmission = { text: string; images: readonly DraftImage[] }

export const draftSubmissionOf = (args: {
  text: string
  tokens: readonly LiveToken[]
}): DraftSubmission => {
  let text = args.text
  const images: DraftImage[] = []

  for (const token of [...args.tokens].sort((a, b) => b.start - a.start)) {
    const { slot } = token

    if (slot.kind === 'pasted') {
      text = text.slice(0, token.start) + slot.content + text.slice(token.end)
      continue
    }

    if (slot.image === null) continue

    images.push({ ...slot.image, ordinal: slot.ordinal })
    text = text.slice(0, token.start) + text.slice(token.end)
  }

  return { text: text.trim(), images }
}
