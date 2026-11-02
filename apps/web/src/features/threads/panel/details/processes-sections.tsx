'use client'

import { EServiceStatus, foldServices, serviceFailed } from '@dltech/atlas-core'
import { CircleCheckIcon, CircleIcon, CircleXIcon, ScrollTextIcon, SquareIcon } from 'lucide-react'

import { DetailRow } from '@dltech/atlas-ui/ai/detail-row'
import { TableCell, TableRow } from '@dltech/atlas-ui/components/table'

import {
  EProcessKind,
  isServiceRunning,
  isShellRunning,
  processNameOf,
  serviceReadoutOf,
  shellReadoutOf,
} from '../../data/processes-model'
import { undeclaredServicesOf } from '../../data/services-model'
import { useNow } from '../../data/use-now'
import type { ProcessesData } from '../../data/use-processes'
import { ActionButton } from './action-button'
import { earlierLabelOf, keptServiceOf } from './details-model'
import { DetailsSection } from './section'
import { BODY_CELL } from './table-parts'

type Kept = ReturnType<typeof keptServiceOf>

export const adhocFoldOf = (args: { data: ProcessesData; declared: ReadonlySet<string> }) =>
  foldServices({
    services: undeclaredServicesOf({
      services: args.data.services,
      declared: args.declared,
    }).map(keptServiceOf),
  })

export type AdhocFold = ReturnType<typeof adhocFoldOf>

function ServiceIcon({ kept }: { kept: Kept }) {
  if (kept.snapshot.status === EServiceStatus.Running) {
    return <CircleIcon aria-hidden className="size-2.5 fill-current text-success" />
  }
  if (serviceFailed(kept)) return <CircleXIcon aria-hidden className="size-3.5 text-destructive" />
  return <CircleCheckIcon aria-hidden className="size-3.5 text-muted-foreground" />
}

export function AdhocServiceRows(props: { data: ProcessesData; fold: AdhocFold }) {
  const { data, fold } = props
  const now = useNow(fold.shown.length > 0)
  const busy = data.busyId !== null
  const open = (serviceId: string) =>
    data.handleSelect({ kind: EProcessKind.Service, id: serviceId })
  return (
    <>
      {fold.shown.map((kept) => {
        const { snapshot } = kept
        const name = processNameOf(snapshot)
        return (
          <TableRow key={snapshot.serviceId}>
            <TableCell className={`${BODY_CELL} w-6`}>
              <span className="flex size-4 items-center justify-center text-muted-foreground">
                <ServiceIcon kept={kept} />
              </span>
            </TableCell>
            <TableCell colSpan={3} className={`${BODY_CELL} max-w-0`}>
              <span className="block truncate font-mono text-sm" title={name}>
                {name}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {`ad-hoc · ${serviceReadoutOf({ service: snapshot, now })}`}
              </span>
            </TableCell>
            <TableCell className={BODY_CELL}>
              <span className="flex items-center justify-end gap-0.5">
                <ActionButton
                  icon={ScrollTextIcon}
                  label={`Open ${name} log`}
                  disabled={false}
                  onAction={() => open(snapshot.serviceId)}
                />
                {isServiceRunning(snapshot) ? (
                  <ActionButton
                    icon={SquareIcon}
                    label={`Stop ${name}`}
                    disabled={busy}
                    onAction={() => void data.handleStop(snapshot.serviceId)}
                  />
                ) : null}
              </span>
            </TableCell>
          </TableRow>
        )
      })}
      {fold.hidden > 0 ? (
        <TableRow>
          <TableCell colSpan={5} className={`${BODY_CELL} text-xs text-muted-foreground`}>
            {earlierLabelOf({ hidden: fold.hidden, failed: fold.hiddenFailed })}
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}

export function BackgroundSection({ data }: { data: ProcessesData }) {
  const running = data.shells.filter(isShellRunning)
  const now = useNow(running.length > 0)
  const busy = data.busyId !== null
  if (running.length === 0) return null
  return (
    <DetailsSection title="Background" count={running.length}>
      {running.map((shell) => {
        const name = processNameOf(shell)
        return (
          <DetailRow
            key={shell.shellId}
            mono
            icon={<CircleIcon aria-hidden className="size-2.5 fill-current text-success" />}
            label={name}
            detail={shellReadoutOf({ shell, now })}
            actions={
              <>
                <ActionButton
                  icon={ScrollTextIcon}
                  label={`Open ${name} log`}
                  disabled={false}
                  onAction={() =>
                    data.handleSelect({
                      kind: EProcessKind.Shell,
                      id: shell.shellId,
                    })
                  }
                />
                <ActionButton
                  icon={SquareIcon}
                  label={`Kill ${name}`}
                  disabled={busy}
                  onAction={() => void data.handleKill(shell.shellId)}
                />
              </>
            }
          />
        )
      })}
    </DetailsSection>
  )
}
