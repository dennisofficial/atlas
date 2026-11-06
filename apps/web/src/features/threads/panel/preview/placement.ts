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

export function useSlotTracking(args: {
  slot: HTMLElement | undefined
  frameOf: () => HTMLElement | undefined
}): void {
  const { slot, frameOf } = args
  const latest = useRef(frameOf)
  useEffect(() => {
    latest.current = frameOf
  }, [frameOf])
  useEffect(() => {
    if (slot === undefined) return
    let handle = 0
    let placed: HTMLElement | undefined
    let signature = ''
    const handleFrame = () => {
      const frame = latest.current()
      const placement = placementOf(slot)
      const next = JSON.stringify(placement)
      if (frame !== undefined && (frame !== placed || next !== signature)) {
        applyPlacement({ frame, placement })
        placed = frame
        signature = next
      }
      handle = requestAnimationFrame(handleFrame)
    }
    handleFrame()
    return () => cancelAnimationFrame(handle)
  }, [slot])
}
