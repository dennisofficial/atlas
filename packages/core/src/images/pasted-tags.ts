/**
 * The label the composer writes into the draft where a long paste collapsed, mirroring `imageTag`:
 * the text carries the span, and the paste's full content hangs off the token rather than the text.
 */
export const pastedTag = (ordinal: number, lines: number): string =>
  `[Pasted text #${ordinal} +${lines} lines]`

const PASTED_TAG = /\[Pasted text #(\d+) \+(\d+) lines\]/g

export type PastedTagSpan = { start: number; end: number; ordinal: number; lines: number }

export function pastedTagSpans(text: string): readonly PastedTagSpan[] {
  const spans: PastedTagSpan[] = []

  for (const match of text.matchAll(PASTED_TAG)) {
    if (match.index === undefined) continue
    spans.push({
      start: match.index,
      end: match.index + match[0].length,
      ordinal: Number(match[1]),
      lines: Number(match[2]),
    })
  }

  return spans
}
