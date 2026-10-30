import type { LucideIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'

export function ActionButton(props: {
  icon: LucideIcon
  label: string
  disabled: boolean
  emphasized?: boolean
  onAction: () => void
}) {
  const Icon = props.icon
  return (
    <Button
      variant={props.emphasized === true ? 'secondary' : 'ghost'}
      size="icon-xs"
      disabled={props.disabled}
      aria-label={props.label}
      className={props.emphasized === true ? undefined : 'text-muted-foreground'}
      onClick={props.onAction}
    >
      <Icon />
    </Button>
  )
}
