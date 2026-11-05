export enum EViewportKind {
  Full = 'full',
  Fixed = 'fixed',
}

export type Viewport =
  | { kind: EViewportKind.Full }
  | { kind: EViewportKind.Fixed; width: number; height: number }

export interface Size {
  width: number
  height: number
}

export interface ViewportFit extends Size {
  scale: number
}

export interface ViewportPreset {
  label: string
  width: number
  height: number
}

export const STAGE_PADDING = 16
export const MIN_DIMENSION = 100
export const MAX_DIMENSION = 10000
export const FULL_PARAM = 'full'

export const VIEWPORT_PRESETS: readonly ViewportPreset[] = [
  { label: '4K', width: 2560, height: 1440 },
  { label: 'Laptop L', width: 1440, height: 900 },
  { label: 'Laptop', width: 1024, height: 768 },
  { label: 'Tablet', width: 768, height: 1024 },
  { label: 'Mobile L', width: 425, height: 812 },
  { label: 'Mobile M', width: 375, height: 667 },
  { label: 'Mobile S', width: 320, height: 568 },
]

export const FULL_VIEWPORT: Viewport = { kind: EViewportKind.Full }

export function availableSpace({
  viewport,
  container,
}: {
  viewport: Viewport
  container: Size
}): Size {
  if (viewport.kind === EViewportKind.Full) return container
  return {
    width: Math.max(0, container.width - STAGE_PADDING * 2),
    height: Math.max(0, container.height - STAGE_PADDING * 2),
  }
}

export function fitViewport({
  viewport,
  available,
}: {
  viewport: Viewport
  available: Size
}): ViewportFit {
  if (viewport.kind === EViewportKind.Full) {
    return { width: available.width, height: available.height, scale: 1 }
  }
  const scale = Math.min(available.width / viewport.width, available.height / viewport.height, 1)
  return { width: viewport.width, height: viewport.height, scale: Math.max(0, scale) }
}

export function formatZoom(scale: number): string {
  return `${Math.round(scale * 100)}%`
}

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
