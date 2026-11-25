import { space } from '@dltech/atlas-ui/tokens'

export const ROW_PADDING_Y = space(2)
export const ROW_LINE_GAP = space(0.5)
export const LIST_ROW_GAP = space(1)

export const rowSpacingOf = (): { inside: number; between: number } => ({
  inside: ROW_LINE_GAP,
  between: ROW_PADDING_Y * 2 + LIST_ROW_GAP,
})
