'use client'

import type { CommandEntry } from '@dltech/atlas-commands'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@dltech/atlas-ui/components/dialog'

import { CommandEntryLabel } from '@/features/threads/commands/command-menu'

import { commandSectionsOf } from './data/session-commands'

export function CommandListDialog({
  open,
  onOpenChange,
  entries,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  entries: readonly CommandEntry[]
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Commands</DialogTitle>
          <DialogDescription>Type a name in the message box to run it.</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-96 flex-col gap-3 overflow-y-auto">
          {commandSectionsOf(entries).map((section) => (
            <section key={section.group} aria-label={section.group} className="flex flex-col">
              <h3 className="px-2 py-1 text-xs font-medium text-muted-foreground">
                {section.group}
              </h3>
              {section.entries.map((entry) => (
                <div
                  key={`${entry.kind}:${entry.name}`}
                  className="flex items-baseline gap-2 px-2 py-1.5 text-sm"
                >
                  <CommandEntryLabel entry={entry} />
                </div>
              ))}
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
