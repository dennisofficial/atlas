'use client'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@dltech/atlas-ui/components/alert-dialog'

const POD_RESTART_BODY =
  'Running shells and services stop while the sandbox restarts. Files are kept and the agent keeps working.'

export function ResizeBusyDialog({
  open,
  running,
  onOpenChange,
}: {
  open: boolean
  running: readonly string[]
  onOpenChange: (open: boolean) => void
}) {
  const handleClose = () => onOpenChange(false)

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Resize a pod that is working?</AlertDialogTitle>
          <AlertDialogDescription>
            {running.length === 0
              ? POD_RESTART_BODY
              : `${running.join(', ')} running. ${POD_RESTART_BODY}`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="outline" onClick={handleClose}>
            Wait until idle
          </AlertDialogAction>
          <AlertDialogAction onClick={handleClose}>Force restart</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
