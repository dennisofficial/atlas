'use client'

import { useState, type KeyboardEvent } from 'react'
import { FileIcon, FolderIcon } from 'lucide-react'

import {
  Autocomplete,
  AutocompleteContent,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
} from '@dltech/atlas-ui/components/autocomplete'

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
  const [highlighted, setHighlighted] = useState<string | undefined>(undefined)
  const choices = pickerChoices({ entries, query: path })
  const showing = open && choices.length > 0

  const handleOpenChange = (next: boolean, details: { reason: string }) => {
    console.log(`[picker] onOpenChange open=${next} reason=${details.reason}`)
    setOpen(next)
  }
  const handleTyped = (next: string, { reason }: { reason: string }) => {
    console.log(`[picker] typed reason=${reason} value=${next}`)
    if (reason === 'escape-key') return
    onPathChange(next)
    setOpen(true)
  }
  const handleChoose = (choice: string) => {
    onPathChange(choice)
    setOpen(choice.endsWith('/'))
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Tab' || event.shiftKey) return
    const completion = highlighted ?? choices[0]
    if (!showing || completion === undefined || completion === path) return
    event.preventDefault()
    handleChoose(completion)
  }

  return (
    <Autocomplete
      items={choices}
      filter={null}
      autoHighlight
      open={showing}
      onOpenChange={handleOpenChange}
      value={path}
      onValueChange={handleTyped}
      onItemHighlighted={setHighlighted}
    >
      <AutocompleteInput
        id={id}
        className="font-mono"
        placeholder=".env.local"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={invalid || undefined}
        onKeyDown={handleKeyDown}
      />
      <AutocompleteContent>
        <AutocompleteList>
          {(choice: string) => (
            <AutocompleteItem
              key={choice}
              value={choice}
              className="font-mono text-xs"
              onClick={() => handleChoose(choice)}
            >
              {choice.endsWith('/') ? (
                <FolderIcon className="text-muted-foreground" />
              ) : (
                <FileIcon className="text-muted-foreground" />
              )}
              <span className="truncate">{choice}</span>
            </AutocompleteItem>
          )}
        </AutocompleteList>
      </AutocompleteContent>
    </Autocomplete>
  )
}
