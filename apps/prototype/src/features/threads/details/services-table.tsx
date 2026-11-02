import {
  CircleIcon,
  CirclePauseIcon,
  CircleXIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  PlayIcon,
  RotateCwIcon,
  ScrollTextIcon,
  SquareIcon,
} from 'lucide-react'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@dltech/atlas-ui/components/table'

import { DENSE_SERVICES, EDenseServiceState, type DenseService } from './dense-fixtures'
import { DetailsSection } from './section'
import { BODY_CELL, HEAD_CELL, IconAction, MID_COLUMN, Mono, WIDE_COLUMN } from './table-parts'

const STATE_LABEL: Record<EDenseServiceState, string> = {
  [EDenseServiceState.Running]: 'Running',
  [EDenseServiceState.Starting]: 'Starting',
  [EDenseServiceState.Stopped]: 'Stopped',
  [EDenseServiceState.Failed]: 'Failed',
}

function StateIcon({ state }: { state: EDenseServiceState }) {
  const label = STATE_LABEL[state]
  if (state === EDenseServiceState.Running) {
    return (
      <CircleIcon role="img" aria-label={label} className="size-2.5 fill-current text-success" />
    )
  }
  if (state === EDenseServiceState.Starting) {
    return (
      <LoaderCircleIcon
        role="img"
        aria-label={label}
        className="size-3.5 animate-spin text-muted-foreground"
      />
    )
  }
  if (state === EDenseServiceState.Failed) {
    return <CircleXIcon role="img" aria-label={label} className="size-3.5 text-destructive" />
  }
  return (
    <CirclePauseIcon role="img" aria-label={label} className="size-3.5 text-muted-foreground" />
  )
}

function Actions({ service }: { service: DenseService }) {
  const running = service.state === EDenseServiceState.Running
  return (
    <span className="flex items-center justify-end gap-0.5">
      {service.hasUrl ? (
        <IconAction
          label={`Open ${service.name}`}
          icon={<ExternalLinkIcon aria-hidden />}
          disabled={!running}
        />
      ) : null}
      {running ? (
        <>
          <IconAction label={`Logs for ${service.name}`} icon={<ScrollTextIcon aria-hidden />} />
          <IconAction label={`Restart ${service.name}`} icon={<RotateCwIcon aria-hidden />} />
        </>
      ) : null}
      <IconAction
        label={`${running ? 'Stop' : 'Start'} ${service.name}`}
        icon={running ? <SquareIcon aria-hidden /> : <PlayIcon aria-hidden />}
      />
    </span>
  )
}

function ServiceRow({ service }: { service: DenseService }) {
  return (
    <TableRow>
      <TableCell className={`${BODY_CELL} w-6`}>
        <span className="flex size-4 items-center justify-center">
          <StateIcon state={service.state} />
        </span>
      </TableCell>
      <TableCell className={`${BODY_CELL} max-w-0 w-full @[640px]:w-auto @[640px]:max-w-56`}>
        <span className="block truncate font-mono text-sm" title={service.name}>
          {service.name}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {service.adhoc ? 'ad-hoc · ' : ''}
          {STATE_LABEL[service.state]}
        </span>
      </TableCell>
      <TableCell className={`${BODY_CELL} ${MID_COLUMN} text-right`}>
        <Mono>{service.port ?? '—'}</Mono>
      </TableCell>
      <TableCell className={`${BODY_CELL} ${MID_COLUMN} text-right`}>
        <Mono>{service.uptime ?? '—'}</Mono>
      </TableCell>
      <TableCell
        className={`${BODY_CELL} ${WIDE_COLUMN} w-full max-w-0 text-xs text-muted-foreground`}
      >
        <span className="block truncate">
          {service.description ?? (service.adhoc ? 'Ad-hoc' : '')}
        </span>
      </TableCell>
      <TableCell className={BODY_CELL}>
        <Actions service={service} />
      </TableCell>
    </TableRow>
  )
}

export function ServicesTable() {
  return (
    <DetailsSection title="Services" count={DENSE_SERVICES.length}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className={HEAD_CELL}>
              <span className="sr-only">Status</span>
            </TableHead>
            <TableHead className={HEAD_CELL}>Name</TableHead>
            <TableHead className={`${HEAD_CELL} ${MID_COLUMN} text-right`}>Port</TableHead>
            <TableHead className={`${HEAD_CELL} ${MID_COLUMN} text-right`}>Uptime</TableHead>
            <TableHead className={`${HEAD_CELL} ${WIDE_COLUMN}`}>Description</TableHead>
            <TableHead className={`${HEAD_CELL} text-right`}>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {DENSE_SERVICES.map((service) => (
            <ServiceRow key={service.id} service={service} />
          ))}
        </TableBody>
      </Table>
    </DetailsSection>
  )
}
