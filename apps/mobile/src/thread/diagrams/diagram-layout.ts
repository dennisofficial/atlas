import { diagramKey } from '@dltech/atlas-core'

export const MERMAID_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'

export const DIAGRAM_ESTIMATE_HEIGHT = 200
export const DIAGRAM_MIN_HEIGHT = 120
export const DIAGRAM_MAX_HEIGHT = 420
export const DIAGRAM_HEIGHT_CACHE_LIMIT = 200

export interface IDiagramSize {
  width: number
  height: number
}

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
  return Math.round((size.height * targetWidth) / size.width)
}

export const clampDiagramHeight = (height: number): { height: number; clamped: boolean } => ({
  height: Math.min(Math.max(height, DIAGRAM_MIN_HEIGHT), DIAGRAM_MAX_HEIGHT),
  clamped: height > DIAGRAM_MAX_HEIGHT,
})
