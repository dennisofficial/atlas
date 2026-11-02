import { FolderTreeIcon, ListIcon } from 'lucide-react'

import { ToggleGroup, ToggleGroupItem } from '#components/toggle-group'
import type { ChangesLayout } from './changes-types'

interface LayoutToggleProps {
  layout: ChangesLayout
  onLayoutChange: (layout: ChangesLayout) => void
}

export function LayoutToggle({ layout, onLayoutChange }: LayoutToggleProps) {
  const handleValueChange = (value: string[]) => {
    const next = value[0]
    if (next === 'flat' || next === 'tree') onLayoutChange(next)
  }

  return (
    <ToggleGroup
      size="sm"
      spacing={0}
      value={[layout]}
      onValueChange={handleValueChange}
      aria-label="File layout"
    >
      <ToggleGroupItem value="flat" aria-label="List files flat" title="Flat list">
        <ListIcon />
      </ToggleGroupItem>
      <ToggleGroupItem
        value="tree"
        aria-label="Group files by directory"
        title="Group by directory"
      >
        <FolderTreeIcon />
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
