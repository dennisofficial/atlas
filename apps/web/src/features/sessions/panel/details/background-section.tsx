'use client'

import { EShellStatus } from '@dltech/atlas-core'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@dltech/atlas-ui/components/sheet'
import { useState } from 'react'

import { useSessionPaneValue } from '../pane-value'
import { Dot, FoldedRows, Row, SectionHead } from './rows'
import { Reveal } from './reveal'

const TONE: Record<EShellStatus, string> = {
  [EShellStatus.Running]: 'bg-success',
  [EShellStatus.Exited]: 'bg-muted-foreground/40',
  [EShellStatus.Killed]: 'bg-destructive',
  [EShellStatus.Overflowed]: 'bg-destructive',
}

const lastLineOf = (text: string | undefined): string | undefined => {
  if (text === undefined) return undefined
  const lines = text.split('\n').filter((line) => line.trim() !== '')
  return lines.at(-1)
}

export function SessionBackgroundSection() {
  const { view, shellTails } = useSessionPaneValue()
  const [opened, setOpened] = useState<string | undefined>(undefined)
  const selected = view.shellRows.find((row) => row.shellId === opened)
  const handleOpenChange = (open: boolean) => {
    if (!open) setOpened(undefined)
  }
  const tail = selected === undefined ? '' : (shellTails[selected.shellId] ?? '')

  return (
    <Reveal open={view.shellRows.length > 0} section>
      <section data-session-background aria-label="Background" className="flex flex-col">
        <SectionHead
          title="Background"
          count={view.shellRows.length === 0 ? undefined : view.shellRows.length}
        />
        <FoldedRows
          rows={view.shellRows}
          rowKey={(row) => row.shellId}
          render={(row) => (
            <Row
              key={row.shellId}
              leading={<Dot className={row.awaitingInput ? 'bg-warning' : TONE[row.status]} />}
              title={<span className="font-mono">{row.name}</span>}
              meta={lastLineOf(shellTails[row.shellId])}
              label={`Open ${row.name} output`}
              onSelect={() => setOpened(row.shellId)}
            />
          )}
        />
        <Sheet open={selected !== undefined} onOpenChange={handleOpenChange}>
          <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
            {selected === undefined ? null : (
              <>
                <SheetHeader>
                  <SheetTitle className="truncate font-mono">{selected.name}</SheetTitle>
                  <SheetDescription className="truncate font-mono">
                    {selected.command}
                  </SheetDescription>
                </SheetHeader>
                <pre className="min-h-0 flex-1 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-xs whitespace-pre-wrap">
                  {tail === '' ? 'No output yet' : tail}
                </pre>
              </>
            )}
          </SheetContent>
        </Sheet>
      </section>
    </Reveal>
  )
}
