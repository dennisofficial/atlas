'use client'

import { useState } from 'react'
import { FileIcon, FolderIcon } from 'lucide-react'

import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@dltech/atlas-ui/components/combobox'

import { pickerChoices, type TreeEntry } from './data/file-mount-helpers'

export function FilePathPicker({
  id,
  entries,
  path,
  invalid,
  onPathChange,
}: {
  id: string
  entries: readonly TreeEntry[]
  path: string
  invalid: boolean
  onPathChange: (path: string) => void
}) {
  const [open, setOpen] = useState(false)
  const choices = pickerChoices({ entries, query: path })

  const handleValueChange = (next: string | null) => {
    if (next === null) return
    onPathChange(next)
    setOpen(next.endsWith('/'))
  }
  const handleInputChange = (next: string) => onPathChange(next)

  return (
    <Combobox
      items={choices}
      filter={null}
      autoHighlight
      open={open && choices.length > 0}
      onOpenChange={setOpen}
      value={null}
      onValueChange={handleValueChange}
      inputValue={path}
      onInputValueChange={handleInputChange}
    >
      <ComboboxInput
        id={id}
        className="font-mono"
        placeholder=".env.local"
        autoComplete="off"
        spellCheck={false}
        showTrigger={false}
        aria-invalid={invalid || undefined}
      />
      <ComboboxContent>
        <ComboboxList>
          {(choice: string) => (
            <ComboboxItem key={choice} value={choice} className="font-mono text-xs">
              {choice.endsWith('/') ? (
                <FolderIcon className="text-muted-foreground" />
              ) : (
                <FileIcon className="text-muted-foreground" />
              )}
              <span className="truncate">{choice}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
