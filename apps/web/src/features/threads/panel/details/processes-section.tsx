'use client'

import { EServiceStatus, foldServices, serviceFailed } from '@dltech/atlas-core'
import { CircleIcon, CircleXIcon, CircleCheckIcon } from 'lucide-react'

import type { ProcessesData } from '../../data/use-processes'
import {
  isShellRunning,
  processNameOf,
  serviceReadoutOf,
  shellReadoutOf,
} from '../../data/processes-model'
import { useNow } from '../../data/use-now'
import { ERightTab } from '../right-tab'
import { earlierLabelOf, keptServiceOf } from './details-model'
import { DetailsSection, RowButton } from './section'

export function ProcessesSection(props: { data: ProcessesData; onOpen: (tab: ERightTab) => void }) {
  const { shells, services } = props.data
  const running = shells.filter(isShellRunning)
  const fold = foldServices({ services: services.map(keptServiceOf) })
  const now = useNow(running.length + fold.shown.length > 0)
  const open = () => props.onOpen(ERightTab.Processes)

  return (
    <>
      {running.length === 0 ? null : (
        <DetailsSection title="Shells" count={running.length}>
          {running.map((shell) => (
            <RowButton key={shell.shellId} onClick={open}>
              <CircleIcon aria-hidden className="size-2.5 shrink-0 fill-current text-success" />
              <span className="min-w-0 flex-1 truncate">{processNameOf(shell)}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {shellReadoutOf({ shell, now })}
              </span>
            </RowButton>
          ))}
        </DetailsSection>
      )}
      {fold.shown.length === 0 ? null : (
        <DetailsSection title="Services" count={fold.shown.length}>
          {fold.shown.map((kept) => {
            const { snapshot } = kept
            return (
              <RowButton key={snapshot.serviceId} onClick={open}>
                {snapshot.status === EServiceStatus.Running ? (
                  <CircleIcon aria-hidden className="size-2.5 shrink-0 fill-current text-success" />
                ) : serviceFailed(kept) ? (
                  <CircleXIcon aria-hidden className="size-3.5 shrink-0 text-destructive" />
                ) : (
                  <CircleCheckIcon
                    aria-hidden
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                )}
                <span className="min-w-0 flex-1 truncate">{processNameOf(snapshot)}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {serviceReadoutOf({ service: snapshot, now })}
                </span>
              </RowButton>
            )
          })}
          {fold.hidden > 0 ? (
            <RowButton onClick={open}>
              <span className="text-xs text-muted-foreground">
                {earlierLabelOf({
                  hidden: fold.hidden,
                  failed: fold.hiddenFailed,
                })}
              </span>
            </RowButton>
          ) : null}
        </DetailsSection>
      )}
    </>
  )
}
