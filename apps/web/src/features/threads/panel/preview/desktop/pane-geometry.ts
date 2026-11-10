import type { PaneRect } from './pane-command'

const SAMPLE_INSET = 1

// getBoundingClientRect is already in window coordinates, top-left origin with y growing down, so a scrolled panel needs no scroll offset added.
export function windowRectOf(element: Element): PaneRect {
  const { left, top, width, height } = element.getBoundingClientRect()
  return { x: left, y: top, width, height }
}

export function sameRect(a: PaneRect | undefined, b: PaneRect): boolean {
  if (a === undefined) return false
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

export type SamplePoint = { x: number; y: number }

export function samplePointsOf(rect: PaneRect): SamplePoint[] {
  if (rect.width <= SAMPLE_INSET * 2 || rect.height <= SAMPLE_INSET * 2) return []
  const left = rect.x + SAMPLE_INSET
  const right = rect.x + rect.width - SAMPLE_INSET
  const top = rect.y + SAMPLE_INSET
  const bottom = rect.y + rect.height - SAMPLE_INSET
  return [
    { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
    { x: left, y: top },
    { x: right, y: top },
    { x: left, y: bottom },
    { x: right, y: bottom },
  ]
}

export function coveredOf(args: {
  slot: Element
  rect: PaneRect
  topAt: (point: SamplePoint) => Element | null
}): boolean {
  return samplePointsOf(args.rect).some((point) => {
    const top = args.topAt(point)
    return top !== null && top !== args.slot && !args.slot.contains(top)
  })
}
