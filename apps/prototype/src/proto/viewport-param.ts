import { EViewportKind, type Viewport } from './fit-viewport'

export const MIN_DIMENSION = 100
export const MAX_DIMENSION = 10000
export const FULL_PARAM = 'full'

export interface ViewportPreset {
  label: string
  width: number
  height: number
}

export const VIEWPORT_PRESETS: readonly ViewportPreset[] = [
  { label: '1920 × 1080', width: 1920, height: 1080 },
  { label: 'Desktop', width: 1440, height: 900 },
  { label: 'Laptop', width: 1280, height: 800 },
  { label: 'Tablet', width: 768, height: 1024 },
  { label: 'Mobile', width: 390, height: 844 },
]

export const FULL_VIEWPORT: Viewport = { kind: EViewportKind.Full }

export function clampDimension(value: number): number {
  return Math.min(MAX_DIMENSION, Math.max(MIN_DIMENSION, Math.round(value)))
}

export function parseViewportParam(raw: string | null | undefined): Viewport {
  const match = /^(\d{1,5})x(\d{1,5})$/.exec(raw ?? '')
  if (!match) return FULL_VIEWPORT
  return {
    kind: EViewportKind.Fixed,
    width: clampDimension(Number(match[1])),
    height: clampDimension(Number(match[2])),
  }
}

export function formatViewportParam(viewport: Viewport): string {
  if (viewport.kind === EViewportKind.Full) return FULL_PARAM
  return `${viewport.width}x${viewport.height}`
}

export function rotateViewport(viewport: Viewport): Viewport {
  if (viewport.kind === EViewportKind.Full) return viewport
  return { kind: EViewportKind.Fixed, width: viewport.height, height: viewport.width }
}

export function presetParam(preset: ViewportPreset): string {
  return `${preset.width}x${preset.height}`
}

export function describeViewport({
  viewport,
  fit,
}: {
  viewport: Viewport
  fit: { width: number; height: number; scale: number }
}): string {
  const size = `${Math.round(fit.width)} × ${Math.round(fit.height)}`
  if (viewport.kind === EViewportKind.Full) return `Full · ${size}`
  return `${size} · ${Math.round(fit.scale * 100)}%`
}
