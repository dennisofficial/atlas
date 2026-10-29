'use client'

import { Button } from '@dltech/atlas-ui/components/button'

import { cn } from '@dltech/atlas-ui/lib/utils'

export function ConfigFooter({
  dirty,
  canSave = dirty,
  onDiscard,
  onSave,
}: {
  dirty: boolean
  canSave?: boolean
  onDiscard: () => void
  onSave: () => void
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 -mb-6 mt-4 border-t bg-background px-4 py-3 md:-mx-8 md:-mb-10 md:px-8 before:pointer-events-none before:absolute before:inset-x-0 before:-top-6 before:h-6 before:bg-linear-to-t before:from-background before:to-transparent">
      <div className="flex items-center justify-between gap-3">
        <span
          className={cn(
            'flex items-center gap-2 text-sm',
            dirty ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          <span
            className={cn('size-1.5 rounded-full', dirty ? 'bg-warning' : 'bg-success')}
            aria-hidden
          />
          {dirty ? 'Unsaved changes' : 'In sync'}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" disabled={!dirty} onClick={onDiscard}>
            Discard
          </Button>
          <Button size="sm" disabled={!canSave} onClick={onSave}>
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}
