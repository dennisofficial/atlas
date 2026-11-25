import { diagramKey } from '@dltech/atlas-core'

export const MERMAID_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'

export const DIAGRAM_ESTIMATE_HEIGHT = 200
export const DIAGRAM_MIN_HEIGHT = 120
export const DIAGRAM_MAX_HEIGHT = 420
export const DIAGRAM_HEIGHT_CACHE_LIMIT = 200
export const DIAGRAM_MIN_SCALE = 0.4
export const DIAGRAM_MAX_SCALE = 5
export const DIAGRAM_SCALE_FLOOR = 0.01

export interface IDiagramSize {
  width: number
  height: number
}

export interface IDiagramTransform {
  scale: number
  x: number
  y: number
}

export interface IDiagramCardState {
  error?: string
  size?: IDiagramSize
}

export enum EDiagramCardEvent {
  Rendered = 'rendered',
  Failed = 'failed',
}

export type TDiagramCardEvent =
  | { type: EDiagramCardEvent.Rendered; size: IDiagramSize }
  | { type: EDiagramCardEvent.Failed; message: string }

const heights = new Map<string, number>()

export const diagramHeightKey = ({ source, width }: { source: string; width: number }): string =>
  `${diagramKey(source)}::${Math.round(width)}`

export const cachedDiagramHeight = ({
  source,
  width,
}: {
  source: string
  width: number
}): number | undefined => heights.get(diagramHeightKey({ source, width }))

export const cacheDiagramHeight = ({
  source,
  width,
  height,
}: {
  source: string
  width: number
  height: number
}): void => {
  heights.set(diagramHeightKey({ source, width }), height)
  if (heights.size <= DIAGRAM_HEIGHT_CACHE_LIMIT) return
  const oldest = heights.keys().next()
  if (!oldest.done) heights.delete(oldest.value)
}

export const fitDiagramHeight = ({
  size,
  targetWidth,
}: {
  size: IDiagramSize
  targetWidth: number
}): number => {
  if (size.width <= 0 || size.height <= 0 || targetWidth <= 0) return DIAGRAM_ESTIMATE_HEIGHT
  return Math.round(size.height * Math.min(1, targetWidth / size.width))
}

export const clampDiagramHeight = (height: number): { height: number; clamped: boolean } => ({
  height: Math.min(Math.max(height, DIAGRAM_MIN_HEIGHT), DIAGRAM_MAX_HEIGHT),
  clamped: height > DIAGRAM_MAX_HEIGHT,
})

export const diagramCardKey = (source: string): string => diagramKey(source)

export const initialDiagramCardState: IDiagramCardState = {}

export const diagramCardReducer = (
  state: IDiagramCardState,
  event: TDiagramCardEvent,
): IDiagramCardState => {
  switch (event.type) {
    case EDiagramCardEvent.Rendered:
      return { size: event.size }
    case EDiagramCardEvent.Failed:
      return { error: event.message }
  }
}

export const fitScale = ({
  viewport,
  content,
}: {
  viewport: IDiagramSize
  content: IDiagramSize
}): number => {
  if (viewport.width <= 0 || viewport.height <= 0) return 1
  if (content.width <= 0 || content.height <= 0) return 1
  return Math.min(viewport.width / content.width, viewport.height / content.height, 1)
}

export const minScaleFor = (scale: number): number =>
  Math.max(Math.min(scale, DIAGRAM_MIN_SCALE), DIAGRAM_SCALE_FLOOR)

export const clampScale = ({ scale, min }: { scale: number; min: number }): number =>
  Math.min(Math.max(scale, min), DIAGRAM_MAX_SCALE)

export const zoomAbout = ({
  transform,
  factor,
  focus,
  min,
}: {
  transform: IDiagramTransform
  factor: number
  focus: { x: number; y: number }
  min: number
}): IDiagramTransform => {
  if (transform.scale <= 0) return { ...transform, scale: 1 }
  const scale = clampScale({ scale: transform.scale * factor, min })
  if (scale === transform.scale) return transform
  const ratio = scale / transform.scale
  return {
    scale,
    x: focus.x - ratio * (focus.x - transform.x),
    y: focus.y - ratio * (focus.y - transform.y),
  }
}
