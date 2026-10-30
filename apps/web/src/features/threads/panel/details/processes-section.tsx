'use client'

import { EServiceStatus, foldServices, serviceFailed } from '@dltech/atlas-core'
import { CircleIcon, CircleXIcon, CircleCheckIcon } from 'lucide-react'

import { DetailRow } from '@dltech/atlas-ui/ai/detail-row'

import type { ProcessesData } from '../../data/use-processes'
import {
  isShellRunning,
  processNameOf,
  serviceReadoutOf,
  shellReadoutOf,
} from '../../data/processes-model'
import { undeclaredServicesOf } from '../../data/services-model'
import { useNow } from '../../data/use-now'
import { ERightTab } from '../right-tab'
import { earlierLabelOf, keptServiceOf } from './details-model'
import { DetailsSection } from './section'

function ServiceIcon({ kept }: { kept: ReturnType<typeof keptServiceOf> }) {
  if (kept.snapshot.status === EServiceStatus.Running) {
    return <CircleIcon aria-hidden className="size-2.5 fill-current text-success" />
  }
  if (serviceFailed(kept)) return <CircleXIcon aria-hidden className="size-3.5 text-destructive" />
  return <CircleCheckIcon aria-hidden className="size-3.5 text-muted-foreground" />
}

export function ProcessesSection(props: {
  data: ProcessesData
  declared: ReadonlySet<string>
  onOpen: (tab: ERightTab) => void
}) {
  const { shells } = props.data
  const services = undeclaredServicesOf({ services: props.data.services, declared: props.declared })
  const running = shells.filter(isShellRunning)
  const fold = foldServices({ services: services.map(keptServiceOf) })
  const now = useNow(running.length + fold.shown.length > 0)
  const open = () => props.onOpen(ERightTab.Processes)

  return (
    <>
      {running.length === 0 ? null : (
        <DetailsSection title="Shells" count={running.length}>
          {running.map((shell) => (
            <DetailRow
              key={shell.shellId}
              icon={<CircleIcon aria-hidden className="size-2.5 fill-current text-success" />}
              label={processNameOf(shell)}
              meta={shellReadoutOf({ shell, now })}
              onClick={open}
            />
          ))}
        </DetailsSection>
      )}
      {fold.shown.length === 0 ? null : (
        <DetailsSection title="Services" count={fold.shown.length}>
          {fold.shown.map((kept) => {
            const { snapshot } = kept
            return (
              <DetailRow
                key={snapshot.serviceId}
                icon={<ServiceIcon kept={kept} />}
                label={processNameOf(snapshot)}
                meta={serviceReadoutOf({ service: snapshot, now })}
                onClick={open}
              />
            )
          })}
          {fold.hidden > 0 ? (
            <DetailRow
              onClick={open}
              label={
                <span className="text-xs text-muted-foreground">
                  {earlierLabelOf({
                    hidden: fold.hidden,
                    failed: fold.hiddenFailed,
                  })}
                </span>
              }
            />
          ) : null}
        </DetailsSection>
      )}
    </>
  )
}
