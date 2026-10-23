import { useEffect } from 'react'

export enum EDiagramWheel {
  Scroll = 'scroll',
  Zoom = 'zoom',
  Hold = 'hold',
}

const PINCH_PIXELS_PER_STEP = 24
const SCROLL_PIXELS_PER_STEP = 120
const LINE_PIXELS = 16
const PAGE_PIXELS = 800
const DIAGRAM = '[data-streamdown="mermaid-block"]'
const FULLSCREEN_DIAGRAM = '[data-streamdown="mermaid-fullscreen"]'

export function wheelPixels({ deltaY, deltaMode }: { deltaY: number; deltaMode: number }) {
  if (deltaMode === 1) return deltaY * LINE_PIXELS
  if (deltaMode === 2) return deltaY * PAGE_PIXELS
  return deltaY
}

// Streamdown's pan-zoom applies one fixed zoom step per wheel event, whatever its delta,
// so a trackpad's stream of tiny events zooms wildly. Only every Nth pixel's worth is let
// through, and outside fullscreen a plain scroll goes to the page instead of the diagram.
export function routeDiagramWheel({
  pixels,
  pinch,
  fullscreen,
  pending,
}: {
  pixels: number
  pinch: boolean
  fullscreen: boolean
  pending: number
}): { action: EDiagramWheel; pending: number } {
  if (!pinch && !fullscreen) return { action: EDiagramWheel.Scroll, pending: 0 }

  const sameDirection = Math.sign(pending) === Math.sign(pixels)
  const total = (sameDirection ? pending : 0) + pixels
  const step = pinch ? PINCH_PIXELS_PER_STEP : SCROLL_PIXELS_PER_STEP
  if (Math.abs(total) < step) return { action: EDiagramWheel.Hold, pending: total }

  return { action: EDiagramWheel.Zoom, pending: total - Math.sign(total) * step }
}

let pending = 0
let subscribers = 0

function handleDiagramWheel(event: WheelEvent) {
  if (!(event.target instanceof Element)) return
  const fullscreen = event.target.closest(FULLSCREEN_DIAGRAM) !== null
  if (!fullscreen && event.target.closest(DIAGRAM) === null) return

  const route = routeDiagramWheel({
    pixels: wheelPixels(event),
    pinch: event.ctrlKey,
    fullscreen,
    pending,
  })
  pending = route.pending
  if (route.action === EDiagramWheel.Zoom) return

  event.stopImmediatePropagation()
  if (route.action === EDiagramWheel.Hold) event.preventDefault()
}

export function useDiagramWheelDamping() {
  useEffect(() => {
    subscribers += 1
    if (subscribers === 1) {
      window.addEventListener('wheel', handleDiagramWheel, { capture: true, passive: false })
    }
    return () => {
      subscribers -= 1
      if (subscribers === 0) window.removeEventListener('wheel', handleDiagramWheel, true)
    }
  }, [])
}
