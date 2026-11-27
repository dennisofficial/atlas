import { EItemKind, type ISessionSection, type SectionItem } from './session-sections'

const SECTION_HEADER_CELLS = 1

export type TActiveRow = { key: string; sectionIndex: number; itemIndex: number }

export type TRowFrame = { top: number; height: number }

export enum ECenterMove {
  Wait = 'wait',
  Stay = 'stay',
  Scroll = 'scroll',
}

const isSessionOf = ({ item, id }: { item: SectionItem; id: string }): boolean =>
  item.kind === EItemKind.Session && item.entry.id === id

export const activeRowOf = ({
  sections,
  activeId,
}: {
  sections: readonly ISessionSection[]
  activeId: string | null
}): TActiveRow | null => {
  if (activeId === null) return null
  for (const [sectionIndex, section] of sections.entries()) {
    const dataIndex = section.data.findIndex((item) => isSessionOf({ item, id: activeId }))
    const item = section.data[dataIndex]
    if (item === undefined) continue
    return { key: item.key, sectionIndex, itemIndex: dataIndex + SECTION_HEADER_CELLS }
  }
  return null
}

export const isActiveCellOf = ({
  item,
  activeKey,
}: {
  item: unknown
  activeKey: string | null
}): boolean => {
  if (activeKey === null || typeof item !== 'object' || item === null) return false
  if (!('kind' in item) || item.kind !== EItemKind.Session) return false
  return 'key' in item && item.key === activeKey
}

export const centerMoveOf = ({
  row,
  viewportHeight,
}: {
  row: TRowFrame | null
  viewportHeight: number | null
}): ECenterMove => {
  if (viewportHeight === null || viewportHeight <= 0) return ECenterMove.Wait
  if (row === null) return ECenterMove.Scroll
  return row.top + row.height / 2 <= viewportHeight / 2 ? ECenterMove.Stay : ECenterMove.Scroll
}
