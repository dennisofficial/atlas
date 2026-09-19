import { ESidebarPlace } from '@dltech/atlas-harness'

import { justifySpans } from './components/sidebar/cells'
import type { Span } from './components/spans'

export { ESidebarPlace } from '@dltech/atlas-harness'

/**
 * A split row anchors one group of spans to the left edge and another to the right, with the gap
 * between them padded out to the column width — the github section reads the pull request number
 * and state on the left and its check tally on the right.
 */
export type SidebarRowSplit = {
  left: readonly Span[]
  right: readonly Span[]
}

export type SidebarRowContent = readonly Span[] | SidebarRowSplit

/**
 * A row may be a function of the column width because clipping cuts the tail, and for some rows the
 * tail is the reading nobody can afford to lose — a failing check count sits to the right of the
 * passing one. A fixed array is still accepted, and is right for a row that cannot degrade.
 */
export type SidebarRowSpans = SidebarRowContent | ((cells: number) => SidebarRowContent)

export const isSidebarRowSplit = (content: SidebarRowContent): content is SidebarRowSplit =>
  !Array.isArray(content)

export type SidebarSectionRow = {
  id: string
  spans: SidebarRowSpans
  onActivate?: (() => void) | undefined
}

export const spansOf = (args: { row: SidebarSectionRow; cells: number }): SidebarRowContent =>
  typeof args.row.spans === 'function' ? args.row.spans(args.cells) : args.row.spans

export const flattenedSpans = (args: {
  row: SidebarSectionRow
  cells: number
}): readonly Span[] => {
  const content = spansOf(args)
  if (!isSidebarRowSplit(content)) return content
  return justifySpans({ left: content.left, right: content.right, cells: args.cells })
}

export type SidebarSection = {
  id: string
  place: ESidebarPlace
  label?: string | undefined
  rows: readonly SidebarSectionRow[]
}

export const NO_SIDEBAR_SECTIONS: readonly SidebarSection[] = []

const PLACE_RANK: Record<ESidebarPlace, number> = {
  [ESidebarPlace.Facts]: 0,
  [ESidebarPlace.Panels]: 1,
}

const showing = (section: SidebarSection): boolean => section.rows.length > 0

export function orderSections(sections: readonly SidebarSection[]): readonly SidebarSection[] {
  const ranked = sections
    .filter(showing)
    .map((section, index) => ({ section, index }))
    .sort((left, right) => {
      const places = PLACE_RANK[left.section.place] - PLACE_RANK[right.section.place]
      return places === 0 ? left.index - right.index : places
    })

  return ranked.length === 0 ? NO_SIDEBAR_SECTIONS : ranked.map((entry) => entry.section)
}

export const sectionsAt = (args: {
  sections: readonly SidebarSection[]
  place: ESidebarPlace
}): readonly SidebarSection[] => args.sections.filter((section) => section.place === args.place)
