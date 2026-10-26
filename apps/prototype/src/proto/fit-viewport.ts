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

export const STAGE_PADDING = 16

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
