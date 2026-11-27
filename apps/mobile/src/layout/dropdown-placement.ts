import type { TInsets } from './posture'

export const DROPDOWN_WIDTH = 320
export const DROPDOWN_GAP = 6
export const DROPDOWN_MARGIN = 12
export const DROPDOWN_MIN_HEIGHT = 160

export type TRect = { x: number; y: number; width: number; height: number }

export enum EDropdownSide {
  Above = 'above',
  Below = 'below',
}

export type TDropdownPlacement = {
  side: EDropdownSide
  left: number
  width: number
  maxHeight: number
  edge: { top: number } | { bottom: number }
}

export const dropdownSideOf = ({
  anchor,
  windowHeight,
  insets,
}: {
  anchor: TRect
  windowHeight: number
  insets: TInsets
}): EDropdownSide => {
  const above = anchor.y - DROPDOWN_GAP - insets.top - DROPDOWN_MARGIN
  const below =
    windowHeight - insets.bottom - DROPDOWN_MARGIN - (anchor.y + anchor.height + DROPDOWN_GAP)
  return above >= below ? EDropdownSide.Above : EDropdownSide.Below
}

export const dropdownPlacementOf = ({
  anchor,
  window,
  insets,
  keyboardInset,
}: {
  anchor: TRect
  window: { width: number; height: number }
  insets: TInsets
  keyboardInset: number
}): TDropdownPlacement => {
  const width = Math.max(
    0,
    Math.min(DROPDOWN_WIDTH, window.width - insets.left - insets.right - 2 * DROPDOWN_MARGIN),
  )
  const maxLeft = window.width - insets.right - DROPDOWN_MARGIN - width
  const left = Math.max(insets.left + DROPDOWN_MARGIN, Math.min(anchor.x, maxLeft))
  const ceiling = insets.top + DROPDOWN_MARGIN
  const floor = window.height - Math.max(insets.bottom, keyboardInset) - DROPDOWN_MARGIN
  const side = dropdownSideOf({ anchor, windowHeight: window.height, insets })
  if (side === EDropdownSide.Above) {
    const bottomEdge = Math.min(anchor.y - DROPDOWN_GAP, floor)
    return {
      side,
      left,
      width,
      maxHeight: Math.max(0, bottomEdge - ceiling),
      edge: { bottom: window.height - bottomEdge },
    }
  }
  const top = Math.max(
    ceiling,
    Math.min(anchor.y + anchor.height + DROPDOWN_GAP, floor - DROPDOWN_MIN_HEIGHT),
  )
  return { side, left, width, maxHeight: Math.max(0, floor - top), edge: { top } }
}
