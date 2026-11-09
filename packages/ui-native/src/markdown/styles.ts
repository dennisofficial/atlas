import { radius, space } from '@dltech/atlas-ui/tokens'
import { StyleSheet } from 'react-native'

import { EFontWeight, ETextRole, ETextTone } from '../text-style'

export interface IInlineStyle {
  size: ETextRole
  weight: EFontWeight
  tone: ETextTone
  uppercase?: boolean
}

export const BODY: IInlineStyle = {
  size: ETextRole.Sm,
  weight: EFontWeight.Regular,
  tone: ETextTone.Foreground,
}

export const LIST_INDENT = space(5)
export const LIST_GAP = space(1)
export const LIST_TEXT_INDENT = space(1)
export const BLOCK_GAP = space(4)
export const INLINE_CODE_SCALE = 0.9
export const INLINE_CODE_LEADING = 1.625

export const FALLBACK_HEADING = {
  size: ETextRole.Xs,
  weight: EFontWeight.Medium,
  tone: ETextTone.Muted,
}

export const HEADINGS = [
  { size: ETextRole.Lg, weight: EFontWeight.Semibold, tone: ETextTone.Foreground },
  { size: ETextRole.Base, weight: EFontWeight.Semibold, tone: ETextTone.Primary },
  { size: ETextRole.Sm, weight: EFontWeight.Semibold, tone: ETextTone.Foreground },
  { size: ETextRole.Sm, weight: EFontWeight.Medium, tone: ETextTone.Foreground },
  { size: ETextRole.Sm, weight: EFontWeight.Medium, tone: ETextTone.Muted },
  { size: ETextRole.Xs, weight: EFontWeight.Medium, tone: ETextTone.Muted },
] as const

export const styles = StyleSheet.create({
  root: {
    gap: BLOCK_GAP,
  },
  fill: { flex: 1 },
  em: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  uppercase: { textTransform: 'uppercase' },
  list: {
    gap: LIST_GAP,
    paddingLeft: LIST_INDENT,
  },
  listRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
  },
  marker: {
    marginLeft: -LIST_INDENT,
    textAlign: 'right',
    width: LIST_INDENT,
  },
  listText: {
    paddingLeft: LIST_TEXT_INDENT,
  },
  code: {
    borderRadius: radius(1),
    borderWidth: 1,
    overflow: 'hidden',
  },
  codeHeader: {
    paddingHorizontal: space(2.5),
    paddingTop: space(2.5),
  },
  codeBody: {
    paddingHorizontal: space(2.5),
    paddingVertical: space(2.5),
  },
  table: {
    borderRadius: radius(1),
    borderWidth: 1,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    gap: space(3),
    paddingHorizontal: space(3),
    paddingVertical: space(2),
  },
  quote: {
    borderLeftWidth: 2,
    gap: BLOCK_GAP,
    paddingLeft: space(4),
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginVertical: space(6),
  },
})
