import { LoaderCircleIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'

import { BUSY_REASON, EFailureAction, EFailureStatus, type ActionView } from './scenarios'

export interface ActionButtonProps {
  action: ActionView
  status: EFailureStatus
  onAction: (action: EFailureAction) => void
  short?: boolean
}

const PENDING_LABEL: Partial<Record<EFailureAction, string>> = {
  [EFailureAction.Retry]: 'Retrying…',
  [EFailureAction.Resume]: 'Resuming…',
}

export function ActionButton({ action, status, onAction, short = false }: ActionButtonProps) {
  const pending =
    (status === EFailureStatus.Retrying && action.kind === EFailureAction.Retry) ||
    (status === EFailureStatus.Resuming && action.kind === EFailureAction.Resume)
  const handleClick = () => onAction(action.kind)
  return (
    <Button
      size="sm"
      variant={action.primary ? 'default' : 'outline'}
      disabled={action.disabled}
      title={action.disabled && !pending ? BUSY_REASON : undefined}
      onClick={handleClick}
    >
      {pending ? <LoaderCircleIcon className="animate-spin" data-icon="inline-start" /> : null}
      {pending ? PENDING_LABEL[action.kind] : short ? action.short : action.label}
    </Button>
  )
}
