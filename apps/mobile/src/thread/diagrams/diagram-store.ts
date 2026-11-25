import { diagramKey } from '@dltech/atlas-core'

export const DIAGRAM_STORE_LIMIT = 24

const sources = new Map<string, string>()
let sequence = 0

export const putDiagramSource = ({ source }: { source: string }): string => {
  sequence += 1
  const id = `diagram-${sequence}`
  sources.set(id, diagramKey(source))
  if (sources.size > DIAGRAM_STORE_LIMIT) {
    const oldest = sources.keys().next()
    if (!oldest.done) sources.delete(oldest.value)
  }
  return id
}

export const diagramSourceOf = (id: string | undefined): string | undefined =>
  id === undefined ? undefined : sources.get(id)
