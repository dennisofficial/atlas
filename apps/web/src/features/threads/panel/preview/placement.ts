import { useEffect, useRef } from 'react'

export const FRAME_Z = 10
export const SHEET_FRAME_Z = 51
const SHEET_CONTENT = '[data-slot="sheet-content"]'
const DEVICE_FRAME = '[data-slot="preview-stage-device"]'

export type Placement = {
  left: number
  top: number
  width: number
  height: number
  scale: number
  radius: number
  zIndex: number
}

export function placementFrom(args: {
  rect: { left: number; top: number; width: number }
  layout: { width: number; height: number }
  inSheet: boolean
  deviceRadius: number
}): Placement {
  const { rect, layout, inSheet, deviceRadius } = args
  const scale = layout.width > 0 ? rect.width / layout.width : 1
  return {
    left: rect.left,
    top: rect.top,
    width: layout.width,
    height: layout.height,
    scale,
    radius: scale > 0 ? deviceRadius / scale : deviceRadius,
    zIndex: inSheet ? SHEET_FRAME_Z : FRAME_Z,
  }
}

function deviceRadiusOf(slot: HTMLElement): number {
  const device = slot.closest(DEVICE_FRAME)
  if (device === null) return 0
  return Number.parseFloat(getComputedStyle(device).borderTopLeftRadius) || 0
}

const placementOf = (slot: HTMLElement): Placement =>
  placementFrom({
    rect: slot.getBoundingClientRect(),
    layout: { width: slot.offsetWidth, height: slot.offsetHeight },
    inSheet: slot.closest(SHEET_CONTENT) !== null,
    deviceRadius: deviceRadiusOf(slot),
  })

function applyPlacement(args: { frame: HTMLElement; placement: Placement }): void {
  const { frame, placement } = args
  Object.assign(frame.style, {
    left: `${placement.left}px`,
    top: `${placement.top}px`,
    width: `${placement.width}px`,
    height: `${placement.height}px`,
    transform: `scale(${placement.scale})`,
    transformOrigin: 'top left',
    borderRadius: `${placement.radius}px`,
    zIndex: String(placement.zIndex),
  })
}

const REMEASURE_EVENTS = ['scroll', 'resize', 'transitionend', 'animationend'] as const

export type SlotEnvironment = {
  observeResize: (args: { element: HTMLElement; onResize: () => void }) => () => void
  listen: (args: { type: string; onEvent: () => void }) => () => void
}

export const browserSlotEnvironment: SlotEnvironment = {
  observeResize: ({ element, onResize }) => {
    const observer = new ResizeObserver(onResize)
    observer.observe(element)
    return () => observer.disconnect()
  },
  listen: ({ type, onEvent }) => {
    window.addEventListener(type, onEvent, { capture: true, passive: true })
    return () => window.removeEventListener(type, onEvent, { capture: true })
  },
}

export type SlotTracker = { remeasure: () => void; stop: () => void }

export function trackSlot(args: {
  slot: HTMLElement
  frameOf: () => HTMLElement | undefined
  environment?: SlotEnvironment | undefined
}): SlotTracker {
  const { slot, frameOf, environment = browserSlotEnvironment } = args
  let placed: HTMLElement | undefined
  let placement: Placement | undefined

  const remeasure = (): void => {
    const frame = frameOf()
    if (frame === undefined) return
    const next = placementOf(slot)
    if (frame === placed && placement !== undefined && samePlacement({ a: placement, b: next }))
      return
    applyPlacement({ frame, placement: next })
    placed = frame
    placement = next
  }

  const stops = [
    environment.observeResize({ element: slot, onResize: remeasure }),
    ...REMEASURE_EVENTS.map((type) => environment.listen({ type, onEvent: remeasure })),
  ]
  remeasure()

  return {
    remeasure,
    stop: () => {
      for (const stop of stops) stop()
    },
  }
}

const samePlacement = (args: { a: Placement; b: Placement }): boolean =>
  args.a.left === args.b.left &&
  args.a.top === args.b.top &&
  args.a.width === args.b.width &&
  args.a.height === args.b.height &&
  args.a.scale === args.b.scale &&
  args.a.zIndex === args.b.zIndex

export function useSlotTracking(args: {
  slot: HTMLElement | undefined
  frameOf: () => HTMLElement | undefined
}): void {
  const { slot, frameOf } = args
  const tracker = useRef<SlotTracker | undefined>(undefined)
  useEffect(() => {
    if (slot === undefined) return
    const current = trackSlot({ slot, frameOf })
    tracker.current = current
    return () => {
      current.stop()
      tracker.current = undefined
    }
  }, [slot, frameOf])
  useEffect(() => {
    tracker.current?.remeasure()
  })
}
