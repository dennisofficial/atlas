import { PlusIcon } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'

import { DisconnectedBody, EmptyBody, EndedBody, LiveShell } from './terminal-bodies'
import {
  ETerminalScenario,
  ETerminalStatus,
  MAX_PANE_TERMINALS,
  type PaneTerminal,
  useTerminalScenario,
} from './terminal-scenario'
import { ScenarioSwitch } from './terminal-scenario-switch'
import { TerminalBreadcrumb, TerminalStatusBar } from './terminal-variant-d-chrome'
import { useOverflow } from './terminal-variant-d-overflow'
import { useSeededShells } from './terminal-variant-d-seed'
import { ShellChip, ShellOverflow } from './terminal-variant-d-strip'

function liveCount(terminals: PaneTerminal[]): number {
  return terminals.filter((terminal) => terminal.status === ETerminalStatus.Live).length
}

export function TerminalVariantD() {
  const state = useTerminalScenario()
  useSeededShells(state)
  const { scenario, terminals, activeId, active, setScenario, select, create, close, wake } = state
  const [open, setOpen] = useState(false)
  const { ref, overflowing } = useOverflow(terminals.length)
  const asleep = scenario === ETerminalScenario.Asleep
  const showStrip = !asleep && terminals.length > 0

  const handleSelect = (id: string) => {
    select(id)
    setOpen(false)
  }

  const handleClose = (id: string) => {
    close(id)
    setOpen(false)
  }

  const renderBody = () => {
    if (asleep) return <DisconnectedBody onWake={wake} />
    if (!active) return <EmptyBody onCreate={create} />
    if (active.status === ETerminalStatus.Ended) {
      return <EndedBody terminal={active} onClose={() => close(active.id)} />
    }
    return <LiveShell key={active.id} terminal={active} className="px-0 py-0" />
  }

  const strip = showStrip ? (
    <div className="flex shrink-0 flex-col">
      <div className="flex h-8 items-center gap-1 border-b border-border px-1.5">
        <div ref={ref} className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {terminals.map((terminal) => (
            <ShellChip
              key={terminal.id}
              terminal={terminal}
              active={terminal.id === activeId}
              onSelect={() => select(terminal.id)}
            />
          ))}
        </div>
        {overflowing ? (
          <ShellOverflow
            terminals={terminals}
            activeId={activeId}
            open={open}
            onToggle={() => setOpen(!open)}
            onSelect={handleSelect}
            onClose={handleClose}
          />
        ) : null}
        <Button
          size="icon-xs"
          variant="ghost"
          title="New terminal"
          aria-label="New terminal"
          disabled={liveCount(terminals) >= MAX_PANE_TERMINALS}
          onClick={create}
          className="shrink-0"
        >
          <PlusIcon />
        </Button>
      </div>
      {active ? <TerminalBreadcrumb cwd={active.cwd} /> : null}
    </div>
  ) : null

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {strip}
      <div className="flex min-h-0 flex-1 flex-col">{renderBody()}</div>
      <TerminalStatusBar terminal={asleep ? undefined : active}>
        <ScenarioSwitch
          scenario={scenario}
          onChange={setScenario}
          className="origin-right scale-90 opacity-70 hover:opacity-100"
        />
      </TerminalStatusBar>
    </div>
  )
}
