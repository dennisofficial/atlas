import { space } from '@dltech/atlas-ui/tokens'

export const listTextLayout = {
  flexBasis: 'auto',
  flexGrow: 1,
  flexShrink: 1,
} as const

export const listItemIndent = ({ depth }: { depth: number }): number => space(2) * depth
