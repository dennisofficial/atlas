import { oneLine } from '@dltech/atlas-core'

import { sidebarCells } from '../ui/components/sidebar/cells'
import { SIDEBAR_WIDTH } from '../ui/theme'

export const TITLE_CELLS = sidebarCells({ width: SIDEBAR_WIDTH })

export const oneLineOf = (text: string): string | null => {
  const folded = oneLine(text)
  return folded.length === 0 ? null : folded
}
