'use client'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@dltech/atlas-ui/components/sheet'

import {
  EProcessKind,
  isServiceRunning,
  isShellRunning,
  processCommandOf,
  processNameOf,
  serviceReadoutOf,
  shellReadoutOf,
  type ProcessRef,
} from '../../data/processes-model'
import { useNow } from '../../data/use-now'
import type { ProcessesData } from '../../data/use-processes'
import { ProcessLog } from './process-log'

export const STDIN_CLOSED =
  'Its stdin is closed, so nothing can answer it. Kill it and re-run with input piped in.'

type Opened = {
  name: string
  command: string | undefined
  running: boolean
  readout: (now: number) => string
  warning: string | undefined
  caption: string | undefined
  stopLabel: 'Kill' | 'Stop'
  onStop: () => void
}

const openedOf = (args: { data: ProcessesData; ref: ProcessRef }): Opened | undefined => {
  const { data, ref } = args
  if (ref.kind === EProcessKind.Shell) {
    const shell = data.shells.find((candidate) => candidate.shellId === ref.id)
    if (shell === undefined) return undefined
    return {
      name: processNameOf(shell),
      command: processCommandOf(shell),
      running: isShellRunning(shell),
      readout: (now) => shellReadoutOf({ shell, now }),
      warning: shell.awaitingInput ? STDIN_CLOSED : undefined,
      caption: `${shell.totalCharacters.toLocaleString('en-US')} chars`,
      stopLabel: 'Kill',
      onStop: () => void data.handleKill(shell.shellId),
    }
  }
  const service = data.services.find((candidate) => candidate.serviceId === ref.id)
  if (service === undefined) return undefined
  return {
    name: processNameOf(service),
    command: processCommandOf(service),
    running: isServiceRunning(service),
    readout: (now) => serviceReadoutOf({ service, now }),
    warning: undefined,
    caption: undefined,
    stopLabel: 'Stop',
    onStop: () => void data.handleStop(service.serviceId),
  }
}

function SheetBody(props: { data: ProcessesData; opened: Opened }) {
  const { data, opened } = props
  const now = useNow(opened.running)
  return (
    <>
      <SheetHeader>
        <SheetTitle className="truncate font-mono">{opened.name}</SheetTitle>
        <SheetDescription className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0">{opened.readout(now)}</span>
          {opened.command === undefined ? null : (
            <span className="truncate font-mono" title={opened.command}>
              {opened.command}
            </span>
          )}
        </SheetDescription>
        {opened.running ? (
          <div className="pt-1">
            <Button
              variant="destructive"
              size="xs"
              disabled={data.busyId !== null}
              onClick={opened.onStop}
            >
              {opened.stopLabel}
            </Button>
          </div>
        ) : null}
      </SheetHeader>
      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {data.notice ?? ''}
      </p>
      {opened.warning === undefined ? null : (
        <p className="text-xs text-warning">{opened.warning}</p>
      )}
      <ProcessLog text={data.log} caption={opened.caption} />
    </>
  )
}

export function ProcessLogSheet({ data }: { data: ProcessesData }) {
  const opened = data.selected === null ? undefined : openedOf({ data, ref: data.selected })
  const handleOpenChange = (open: boolean) => {
    if (!open) data.handleSelect(null)
  }
  return (
    <Sheet open={opened !== undefined} onOpenChange={handleOpenChange}>
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        {opened === undefined ? null : <SheetBody data={data} opened={opened} />}
      </SheetContent>
    </Sheet>
  )
}
