import { GitBranchIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from '@dltech/atlas-ui/components/combobox'

import { branchFromLabel, branchItems, defaultBranchLabel } from './overview-model'

export function BranchPicker({
  id,
  defaultBranch,
  value,
  onChange,
  defaultOpen,
}: {
  id: string
  defaultBranch: string
  value: string | null
  onChange: (next: string | null) => void
  defaultOpen?: boolean
}) {
  const items = branchItems(defaultBranch)
  const label = value ?? defaultBranchLabel(defaultBranch)

  const handleValueChange = (next: string | null) => {
    if (next === null) return
    onChange(branchFromLabel({ label: next, defaultBranch }))
  }

  return (
    <Combobox
      items={items}
      value={label}
      onValueChange={handleValueChange}
      defaultOpen={defaultOpen}
    >
      <ComboboxTrigger
        render={<Button id={id} variant="outline" className="w-full justify-between font-normal" />}
      >
        <span className="flex min-w-0 items-center gap-2">
          <GitBranchIcon className="text-muted-foreground" />
          <span className="truncate">
            <ComboboxValue>{(selected: string) => selected}</ComboboxValue>
          </span>
        </span>
      </ComboboxTrigger>
      <ComboboxContent>
        <ComboboxInput showTrigger={false} placeholder="Search branches" />
        <ComboboxEmpty>No branches found.</ComboboxEmpty>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item}>
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
