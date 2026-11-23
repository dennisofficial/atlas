'use client'

import { useEffect } from 'react'

import type { CommandEntry } from '@dltech/atlas-commands'

export const COMMAND_MENU_ID = 'command-menu'
const groupIdOf = (group: string): string => `${COMMAND_MENU_ID}-group-${group}`
export const optionIdOf = (index: number): string => `${COMMAND_MENU_ID}-option-${index}`

export function CommandEntryLabel({ entry }: { entry: CommandEntry }) {
  return (
    <>
      <span className="shrink-0 font-medium">/{entry.name}</span>
      {entry.argumentHint === undefined ? null : (
        <span className="shrink-0 text-muted-foreground">{entry.argumentHint}</span>
      )}
      <span
        title={entry.summary}
        className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground"
      >
        {entry.summary}
      </span>
    </>
  )
}

export function CommandMenu({
  candidates,
  active,
  onSelect,
}: {
  candidates: readonly CommandEntry[]
  active: number
  onSelect: (entry: CommandEntry) => void
}) {
  useEffect(() => {
    const node = document.getElementById(optionIdOf(active))
    if (typeof node?.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' })
  }, [active])

  const groups = candidates.reduce<
    { group: string; items: { entry: CommandEntry; index: number }[] }[]
  >((found, entry, index) => {
    const last = found[found.length - 1]
    if (last !== undefined && last.group === entry.group) last.items.push({ entry, index })
    else found.push({ group: entry.group, items: [{ entry, index }] })
    return found
  }, [])

  return (
    <div
      id={COMMAND_MENU_ID}
      role="listbox"
      aria-label="Commands"
      className="absolute inset-x-0 bottom-full z-20 mb-2 max-h-64 overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {groups.map(({ group, items }) => (
        <fieldset
          key={group}
          aria-labelledby={groupIdOf(group)}
          className="m-0 min-w-0 border-0 p-0"
        >
          <div
            id={groupIdOf(group)}
            role="presentation"
            className="px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground"
          >
            {group}
          </div>
          {items.map(({ entry, index }) => (
            <div
              key={`${entry.kind}:${entry.name}`}
              id={optionIdOf(index)}
              role="option"
              tabIndex={-1}
              aria-selected={index === active}
              onMouseDown={(event) => {
                event.preventDefault()
                onSelect(entry)
              }}
              className="flex cursor-pointer items-baseline gap-2 rounded-lg px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
            >
              <CommandEntryLabel entry={entry} />
            </div>
          ))}
        </fieldset>
      ))}
    </div>
  )
}
