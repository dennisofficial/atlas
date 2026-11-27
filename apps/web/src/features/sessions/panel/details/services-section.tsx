'use client'

import { EPodPowerPhase, EServiceStatus } from '@dltech/atlas-core'
import type { ServiceRow } from '@dltech/atlas-plugin-services/core'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@dltech/atlas-ui/components/sheet'
import { Button } from '@dltech/atlas-ui/components/button'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRightIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { messageOf } from '@/features/threads/data/message-of'
import { isPodParked } from '@/features/threads/data/file-source'

import { restartService, stopService } from '../../data/service-actions'
import { fetchServiceLog, serviceLogKey } from '../../data/service-log'
import { sessionsApi } from '../../data/sessions-api'
import { useSessionPaneValue } from '../pane-value'
import { Dot, EmptyLine, FoldedRows, Row, SectionHead } from './rows'

const TONE: Record<EServiceStatus, string> = {
  [EServiceStatus.Running]: 'bg-success',
  [EServiceStatus.Exited]: 'bg-muted-foreground/40',
  [EServiceStatus.Killed]: 'bg-destructive',
}

const nameOf = (row: ServiceRow): string => (row.name ?? row.command).trim()

const pausedOf = (args: { row: ServiceRow; asleep: boolean }): boolean =>
  args.asleep && args.row.status === EServiceStatus.Running

function PausedTag() {
  return <span className="text-[11px] text-muted-foreground">paused</span>
}

function ServiceVerbs(props: { sessionId: string; service: ServiceRow }) {
  const client = useQueryClient()
  const key = serviceLogKey({ sessionId: props.sessionId, serviceId: props.service.serviceId })
  if (props.service.status !== EServiceStatus.Running) return null

  const handleStop = () => {
    stopService({
      api: sessionsApi,
      sessionId: props.sessionId,
      serviceId: props.service.serviceId,
    }).catch((failure: unknown) => toast.error(messageOf(failure)))
  }

  const handleRestart = () => {
    restartService({
      api: sessionsApi,
      sessionId: props.sessionId,
      serviceId: props.service.serviceId,
    })
      .then(() => client.invalidateQueries({ queryKey: key }))
      .catch((failure: unknown) => toast.error(messageOf(failure)))
  }

  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <Button
        type="button"
        variant="ghost"
        size="row"
        data-service-stop={props.service.serviceId}
        onClick={handleStop}
      >
        Stop
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="row"
        data-service-restart={props.service.serviceId}
        onClick={handleRestart}
      >
        Restart
      </Button>
    </span>
  )
}

function ServiceLog(props: { sessionId: string; service: ServiceRow }) {
  const query = useQuery({
    queryKey: serviceLogKey({ sessionId: props.sessionId, serviceId: props.service.serviceId }),
    queryFn: () =>
      fetchServiceLog({ sessionId: props.sessionId, serviceId: props.service.serviceId }),
  })

  if (query.isPending) return <p className="text-[11px] text-muted-foreground">Reading the log…</p>
  if (query.isError)
    return (
      <p className="text-[11px] text-muted-foreground">
        {isPodParked(query.error)
          ? 'The pod is asleep. Wake it to read the log.'
          : 'The log is unavailable.'}
      </p>
    )
  return (
    <>
      {query.data.truncated ? (
        <p className="text-[11px] text-muted-foreground">Showing the last 64 KiB.</p>
      ) : null}
      <pre className="min-h-0 flex-1 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-xs whitespace-pre-wrap">
        {query.data.text === '' ? 'No output yet' : query.data.text}
      </pre>
    </>
  )
}

export function SessionServicesSection() {
  const { sessionId, view, status, openBrowser } = useSessionPaneValue()
  const asleep = status?.pod?.power?.phase === EPodPowerPhase.Asleep
  const [opened, setOpened] = useState<string | undefined>(undefined)
  const selected = view.serviceRows.find((row) => row.serviceId === opened)
  const previewOf = (serviceId: string) =>
    view.previews.find((preview) => preview.serviceId === serviceId)
  const handleOpenChange = (open: boolean) => {
    if (!open) setOpened(undefined)
  }

  return (
    <section data-session-services aria-label="Services" className="flex flex-col">
      <SectionHead
        title="Services"
        count={view.serviceRows.length === 0 ? undefined : view.serviceRows.length}
      />
      {view.serviceRows.length === 0 ? (
        <EmptyLine>No services running</EmptyLine>
      ) : (
        <FoldedRows
          rows={view.serviceRows}
          render={(row) => {
            const preview = previewOf(row.serviceId)
            const name = nameOf(row)
            const paused = pausedOf({ row, asleep })
            return (
              <Row
                key={row.serviceId}
                leading={<Dot className={paused ? 'bg-warning' : TONE[row.status]} />}
                title={
                  <span className="flex items-baseline gap-1">
                    {name}
                    {row.port === undefined ? null : (
                      <span className="font-mono text-[11px] text-muted-foreground">
                        :{row.port}
                      </span>
                    )}
                  </span>
                }
                trailing={
                  <span className="flex items-center gap-1">
                    {paused ? <PausedTag /> : <ServiceVerbs sessionId={sessionId} service={row} />}
                    {preview === undefined ? null : (
                      <button
                        type="button"
                        aria-label={`Open ${preview.label}`}
                        title={preview.url}
                        onClick={() => openBrowser(preview.url)}
                        className="flex items-center gap-0.5 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        open
                        <ArrowUpRightIcon aria-hidden className="size-3" />
                      </button>
                    )}
                  </span>
                }
                label={`Open the ${name} log`}
                onSelect={() => setOpened(row.serviceId)}
              />
            )
          }}
        />
      )}
      <Sheet open={selected !== undefined} onOpenChange={handleOpenChange}>
        <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
          {selected === undefined ? null : (
            <>
              <SheetHeader>
                <SheetTitle className="truncate font-mono">{nameOf(selected)}</SheetTitle>
                <SheetDescription className="truncate font-mono">
                  {selected.command}
                </SheetDescription>
                {pausedOf({ row: selected, asleep }) ? (
                  <p className="text-[11px] text-muted-foreground">
                    Paused while the pod is asleep. It continues when the pod starts.
                  </p>
                ) : (
                  <ServiceVerbs sessionId={sessionId} service={selected} />
                )}
              </SheetHeader>
              <ServiceLog sessionId={sessionId} service={selected} />
            </>
          )}
        </SheetContent>
      </Sheet>
    </section>
  )
}
