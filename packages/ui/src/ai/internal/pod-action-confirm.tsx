'use client'

import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#components/alert-dialog'

export enum EPodAction {
  Stop = 'stop',
  Resize = 'resize',
}

export const POD_CONFIRM_TITLE: Record<EPodAction, string> = {
  [EPodAction.Stop]: 'Stop the pod?',
  [EPodAction.Resize]: 'Restart the pod?',
}

export const POD_CONFIRM_LABEL: Record<EPodAction, string> = {
  [EPodAction.Stop]: 'Stop',
  [EPodAction.Resize]: 'Restart',
}

export const POD_CONFIRM_BODY: Record<EPodAction, string> = {
  [EPodAction.Stop]:
    'The current turn stops. Services and shells pause and continue when the pod starts again. Preview links are down while it sleeps. Files are kept.',
  [EPodAction.Resize]: 'The current turn stops and running processes end. Files are kept.',
}

export interface PodActionConfirmProps {
  action: EPodAction
  onConfirm?: (() => void) | undefined
  onCancel?: (() => void) | undefined
}

export function PodActionConfirmBody({ action, onConfirm, onCancel }: PodActionConfirmProps) {
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{POD_CONFIRM_TITLE[action]}</AlertDialogTitle>
        <AlertDialogDescription>{POD_CONFIRM_BODY[action]}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel onClick={onCancel}>Keep working</AlertDialogCancel>
        <AlertDialogAction variant="destructive" onClick={onConfirm}>
          {POD_CONFIRM_LABEL[action]}
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  )
}

export function PodActionConfirm(props: PodActionConfirmProps) {
  return (
    <AlertDialogContent>
      <PodActionConfirmBody {...props} />
    </AlertDialogContent>
  )
}
