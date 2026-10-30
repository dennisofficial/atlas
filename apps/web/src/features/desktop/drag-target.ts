import { DRAG_SELECTORS, NO_DRAG_SELECTORS } from './desktop-drag-css'

const DRAG = DRAG_SELECTORS.join(',')

export function isDragRegionTarget(target: EventTarget | null): boolean {
  let node = target instanceof Element ? target : null
  while (node) {
    if (node.matches(NO_DRAG_SELECTORS)) return false
    if (node.matches(DRAG)) return true
    node = node.parentElement
  }
  return false
}
