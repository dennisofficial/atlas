import type { TextareaRenderable } from '@opentui/core'
import { imageTag, imageTagSpans, pastedTagSpans } from '@dltech/atlas-core'

import type { TokenSlot, LiveToken } from './composer-tokens'
import type { DraftImage } from './draft-images'

export type PlannedAdoption = { start: number; end: number; ordinal: number }

export type RestoredPasteContent = { ordinal: number; content: string }

export type PlannedPaste = { start: number; end: number; content: string }

export type RestoredDraftPlan = {
  text: string
  adoptions: readonly PlannedAdoption[]
  pastes: readonly PlannedPaste[]
  appends: readonly PlannedAdoption[]
}

type Deletion = { start: number; end: number }

const deletionSpan = (args: { text: string; start: number; end: number }): Deletion => {
  const { start, end } = args
  if (end < args.text.length && args.text[end] === ' ') return { start, end: end + 1 }
  return { start, end }
}

const deletionShift = (args: {
  deletions: readonly Deletion[]
  text: string
  offset: number
}): number =>
  args.deletions
    .filter((deletion) => deletion.start < args.offset)
    .map((deletion) => deletionSpan({ text: args.text, ...deletion }))
    .reduce((total, span) => total + (span.end - span.start), 0)

/**
 * Where a restored draft's tokens land, decided purely from the text and the attachments before an
 * editor ever sees it. A tag whose picture is still attached is adopted at the span it already
 * sits on; a tag naming a picture that is gone is deleted with its buffer space; an attachment the
 * text no longer names is appended at the end so it is not silently dropped. A paste label that
 * survived the round trip is adopted with its content when the caller still has it; without it the
 * label itself is the fallback content, so a re-send at worst echoes the label rather than losing
 * the block silently. The first label per ordinal keeps the supplied content; later duplicates
 * adopt as live tokens with the label fallback.
 */
export function planRestoredTokens(args: {
  text: string
  images: readonly DraftImage[]
  pastes?: readonly RestoredPasteContent[] | undefined
}): RestoredDraftPlan {
  const byOrdinal = new Map(args.images.map((image) => [image.ordinal, image]))
  const deletions: Deletion[] = []
  const adoptions: PlannedAdoption[] = []
  const adopted = new Set<number>()

  for (const span of imageTagSpans(args.text)) {
    if (!byOrdinal.has(span.ordinal) || adopted.has(span.ordinal)) {
      deletions.push({ start: span.start, end: span.end })
      continue
    }
    adopted.add(span.ordinal)
    adoptions.push({ start: span.start, end: span.end, ordinal: span.ordinal })
  }

  let text = args.text
  for (const deletion of [...deletions].sort((a, b) => b.start - a.start)) {
    const span = deletionSpan({ text: args.text, ...deletion })
    text = text.slice(0, span.start) + text.slice(span.end)
  }

  const shift = (offset: number): number =>
    deletionShift({ deletions, text: args.text, offset })

  const pasteContents = new Map((args.pastes ?? []).map((paste) => [paste.ordinal, paste.content]))
  const claimed = new Set<number>()
  const pastes: PlannedPaste[] = pastedTagSpans(args.text).map((span) => {
    const label = args.text.slice(span.start, span.end)
    if (claimed.has(span.ordinal)) {
      return { start: span.start - shift(span.start), end: span.end - shift(span.start), content: label }
    }
    claimed.add(span.ordinal)
    return {
      start: span.start - shift(span.start),
      end: span.end - shift(span.start),
      content: pasteContents.get(span.ordinal) ?? label,
    }
  })

  const movedAdoptions = adoptions.map((adoption) => ({
    ...adoption,
    start: adoption.start - shift(adoption.start),
    end: adoption.end - shift(adoption.start),
  }))

  const dangling = args.images.filter((image) => !adopted.has(image.ordinal))

  if (dangling.length > 0 && text.length > 0 && !text.endsWith(' ')) text += ' '

  const appends: PlannedAdoption[] = []
  for (const image of dangling) {
    const label = imageTag(image.ordinal)
    appends.push({ start: text.length, end: text.length + label.length, ordinal: image.ordinal })
    text += `${label} `
  }

  return { text, adoptions: movedAdoptions, pastes, appends }
}

/**
 * Tokenises a span of text that is already in the buffer — the restore path's counterpart to
 * `insertToken`, which types its label. Nothing is inserted; the extmark alone is what makes the
 * span live.
 */
export function adoptToken(args: {
  editor: TextareaRenderable
  start: number
  end: number
  slot: TokenSlot
}): LiveToken {
  const id = args.editor.extmarks.create({
    start: args.start,
    end: args.end,
    virtual: true,
    data: args.slot,
  })
  const ordinal = args.slot.kind === 'image' ? args.slot.ordinal : 0
  return { id, start: args.start, end: args.end, ordinal, slot: args.slot }
}

/**
 * Puts a previously-sent draft back into the editor with its tokens re-tokenised in place. The
 * whole plan is decided against the raw text first, then applied in one replaceText, so the
 * extmarks land on offsets that cannot drift mid-application.
 */
export function restoredDraft(args: {
  editor: TextareaRenderable
  text: string
  images: readonly DraftImage[]
  pastes?: readonly RestoredPasteContent[] | undefined
}): void {
  const plan = planRestoredTokens({ text: args.text, images: args.images, pastes: args.pastes })

  args.editor.extmarks.clear()
  args.editor.replaceText(plan.text)
  args.editor.cursorOffset = plan.text.length

  const byOrdinal = new Map(args.images.map((image) => [image.ordinal, image]))

  for (const adoption of [...plan.adoptions, ...plan.appends]) {
    const image = byOrdinal.get(adoption.ordinal)
    if (image === undefined) continue
    adoptToken({
      editor: args.editor,
      start: adoption.start,
      end: adoption.end,
      slot: { kind: 'image', ordinal: image.ordinal, settled: true, image },
    })
  }

  for (const paste of plan.pastes) {
    const label = plan.text.slice(paste.start, paste.end)
    adoptToken({
      editor: args.editor,
      start: paste.start,
      end: paste.end,
      slot: { kind: 'pasted', label, content: paste.content },
    })
  }
}
