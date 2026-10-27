import { XIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'

import {
  ETerminalTabState,
  exitLabelOf,
  type TerminalTabView,
} from '../../data/terminal-session-set'

const statusOf = (tab: TerminalTabView): string => {
  if (tab.state === ETerminalTabState.Ended) return exitLabelOf(tab.exit)
  if (tab.state === ETerminalTabState.Failed) return 'Shell failed to open'
  return ''
}

export type ShellBarProps = {
  tab: TerminalTabView
  onClose: (id: string) => void
}

export function ShellBar({ tab, onClose }: ShellBarProps) {
  const handleClose = () => onClose(tab.id)

  return (
    <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border px-3 text-xs text-muted-foreground">
      <span className="min-w-0 flex-1 truncate">{statusOf(tab)}</span>
      <Button size="icon-xs" variant="ghost" aria-label={`Close ${tab.name}`} onClick={handleClose}>
        <XIcon />
      </Button>
    </div>
  )
}
