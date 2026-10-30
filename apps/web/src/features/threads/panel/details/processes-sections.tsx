'use client'

import { EServiceStatus, foldServices, serviceFailed } from '@dltech/atlas-core'
import { CircleCheckIcon, CircleIcon, CircleXIcon, ScrollTextIcon, SquareIcon } from 'lucide-react'

import { DetailRow } from '@dltech/atlas-ui/ai/detail-row'

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
          <DetailRow
            key={snapshot.serviceId}
            mono
            icon={<ServiceIcon kept={kept} />}
            label={name}
            detail={`ad-hoc · ${serviceReadoutOf({ service: snapshot, now })}`}
            actions={
              <>
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
              </>
            }
          />
        )
      })}
      {fold.hidden > 0 ? (
        <p className="px-1 text-xs text-muted-foreground">
          {earlierLabelOf({ hidden: fold.hidden, failed: fold.hiddenFailed })}
        </p>
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
