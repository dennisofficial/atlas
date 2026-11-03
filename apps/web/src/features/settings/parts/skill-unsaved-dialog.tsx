'use client'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@dltech/atlas-ui/components/dialog'

export function UnsavedGuardDialog({
  targetPath,
  currentPath,
  onKeepEditing,
  onDiscard,
  onSaveAndSwitch,
}: {
  targetPath: string | null
  currentPath: string
  onKeepEditing: () => void
  onDiscard: (targetPath: string | null) => void
  onSaveAndSwitch: (targetPath: string | null) => void
}) {
  return (
    <Dialog
      open={targetPath !== null}
      onOpenChange={(open) => {
        if (!open) onKeepEditing()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Discard unsaved changes?</DialogTitle>
          <DialogDescription>{currentPath} has changes that are not saved.</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onKeepEditing}>
            Keep editing
          </Button>
          <Button variant="outline" size="sm" onClick={() => onDiscard(targetPath)}>
            Discard
          </Button>
          <Button size="sm" onClick={() => onSaveAndSwitch(targetPath)}>
            Save & switch
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
