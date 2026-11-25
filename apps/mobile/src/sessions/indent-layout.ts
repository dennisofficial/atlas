import { space } from '@dltech/atlas-ui/tokens'

const ROW_INSET = space(2)
const STATUS_ICON_SIZE = 16

export const INDENT_PER_DEPTH = space(6)

const ICON_CENTER = ROW_INSET + STATUS_ICON_SIZE / 2

export const guideOffsetsOf = (depth: number): number[] =>
  Array.from({ length: Math.max(0, depth) }, (_, level) => level * INDENT_PER_DEPTH + ICON_CENTER)
