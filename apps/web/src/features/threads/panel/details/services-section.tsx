'use client'

import { Fragment } from 'react'
import {
  BracesIcon,
  CircleIcon,
  CircleXIcon,
  DatabaseIcon,
  GlobeIcon,
  LoaderCircleIcon,
  PlayIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  SquareArrowOutUpRightIcon,
  SquareIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from 'lucide-react'

import type { PreviewPort } from '@dltech/atlas-ui/ai/preview-frame'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@dltech/atlas-ui/components/table'
import type { DeclaredServiceStateWire, DeclaredServiceViewWire } from '@dltech/atlas-wire/web'

import {
  EOpenTarget,
  EServiceKind,
  hasServicesToShow,
  linkSplitOf,
  openTargetOf,
  restartEmphasizedOf,
  serviceActionsOf,
  serviceKindOf,
  serviceStateLabelOf,
} from '../../data/services-model'
import type { DeclaredServicesData } from '../../data/use-declared-services'
import type { ProcessesData } from '../../data/use-processes'
import { ActionButton } from './action-button'
import { AdhocServiceRows, type AdhocFold } from './processes-sections'
import { DetailsSection } from './section'
import { BODY_CELL, HEAD_CELL, MID_COLUMN, Mono, WIDE_COLUMN } from './table-parts'

export const SERVICE_COLUMNS = 5

function StateIcon({ state }: { state: DeclaredServiceStateWire }) {
  if (state === 'running') {
    return <CircleIcon aria-hidden className="size-2.5 fill-current text-success" />
  }
  if (state === 'starting') {
    return <LoaderCircleIcon aria-hidden className="size-3.5 animate-spin" />
  }
  if (state === 'stale') return <RefreshCwIcon aria-hidden className="size-3.5 text-warning" />
  if (state === 'stopped') return <CircleIcon aria-hidden className="size-2.5" />
  return <CircleXIcon aria-hidden className="size-3.5 text-destructive" />
}

const KIND_ICONS: Record<EServiceKind, LucideIcon> = {
  [EServiceKind.Web]: GlobeIcon,
  [EServiceKind.Api]: BracesIcon,
  [EServiceKind.Database]: DatabaseIcon,
}

function TypeIcon({ service }: { service: DeclaredServiceViewWire }) {
  const kind = serviceKindOf(service)
  if (kind === undefined) return null
  const Icon = KIND_ICONS[kind]
  return (
    <span role="img" aria-label={`${kind} service`} title={kind} className="flex">
      <Icon aria-hidden className="size-3.5" />
    </span>
  )
}

export type ServicesPreview = {
  ports: readonly PreviewPort[]
  onOpen: (serviceId: string) => void
}

function ServiceLinks({ service }: { service: DeclaredServiceViewWire }) {
  const { inline, extra } = linkSplitOf(service)
  if (inline === undefined && extra.length === 0) return null
  const links = inline === undefined ? extra : [inline, ...extra]
  return (
    <>
      {links.map((link) => (
        <a
          key={link.url}
          href={link.url}
          target="_blank"
          rel="noreferrer"
          title={link.description ?? link.url}
          className="underline-offset-2 hover:text-foreground hover:underline"
        >
          {link.title}
        </a>
      ))}
    </>
  )
}

function ServiceRow(props: {
  service: DeclaredServiceViewWire
  data: DeclaredServicesData
  preview?: ServicesPreview
  onOpenLog: (serviceId: string) => void
}) {
  const { service, data, preview, onOpenLog } = props
  const { name, state, serviceId } = service
  const actions = serviceActionsOf(state)
  const busy = data.busyName !== null
  const reason = service.reason ?? undefined
  const handleOpen = () => {
    if (serviceId === undefined) return
    const target = openTargetOf({ service, ports: preview?.ports ?? [] })
    if (target === EOpenTarget.Preview) preview?.onOpen(serviceId)
    else onOpenLog(serviceId)
  }
  const hasLinks = service.links.length > 0 || service.url !== undefined
  return (
    <TableRow>
      <TableCell className={`${BODY_CELL} w-6`}>
        <span className="flex size-4 items-center justify-center text-muted-foreground">
          <StateIcon state={state} />
        </span>
      </TableCell>
      <TableCell className={`${BODY_CELL} w-full max-w-0 @[640px]:w-auto @[640px]:max-w-56`}>
        <span className="block truncate font-mono text-sm" title={name}>
          {name}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {serviceStateLabelOf(state)}
          {reason === undefined ? null : ` · ${reason}`}
        </span>
      </TableCell>
      <TableCell className={`${BODY_CELL} ${MID_COLUMN} text-right`}>
        <Mono>{service.port ?? '—'}</Mono>
      </TableCell>
      <TableCell
        className={`${BODY_CELL} ${WIDE_COLUMN} w-full max-w-0 text-xs text-muted-foreground`}
      >
        <span className="flex items-center gap-2 truncate">
          <TypeIcon service={service} />
          {hasLinks ? <ServiceLinks service={service} /> : null}
        </span>
      </TableCell>
      <TableCell className={BODY_CELL}>
        <span className="flex items-center justify-end gap-0.5">
          <ActionButton
            icon={SquareArrowOutUpRightIcon}
            label={`Open ${name}`}
            disabled={serviceId === undefined}
            onAction={handleOpen}
          />
          {serviceId === undefined ? null : (
            <ActionButton
              icon={ScrollTextIcon}
              label={`Open ${name} log`}
              disabled={false}
              onAction={() => onOpenLog(serviceId)}
            />
          )}
          {actions.start ? (
            <ActionButton
              icon={PlayIcon}
              label={`Start ${name}`}
              disabled={busy}
              onAction={() => void data.handleStart(name)}
            />
          ) : null}
          {actions.restart && serviceId !== undefined ? (
            <ActionButton
              icon={RefreshCwIcon}
              label={`Restart ${name}`}
              disabled={busy}
              emphasized={restartEmphasizedOf(state)}
              onAction={() => void data.handleRestart({ name, serviceId })}
            />
          ) : null}
          {actions.stop && serviceId !== undefined ? (
            <ActionButton
              icon={SquareIcon}
              label={`Stop ${name}`}
              disabled={busy}
              onAction={() => void data.handleStop({ name, serviceId })}
            />
          ) : null}
        </span>
      </TableCell>
    </TableRow>
  )
}

export function WarningRow({ text }: { text: string }) {
  return (
    <TableRow>
      <TableCell colSpan={SERVICE_COLUMNS} className={BODY_CELL}>
        <span className="flex items-start gap-2 text-xs">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning" />
          {text}
        </span>
      </TableCell>
    </TableRow>
  )
}

export type AdhocServices = { data: ProcessesData; fold: AdhocFold }

export function ServicesSection(props: {
  data: DeclaredServicesData
  onOpenLog: (serviceId: string) => void
  preview?: ServicesPreview
  adhoc?: AdhocServices
}) {
  const { view, error } = props.data
  const declaredShown = view !== null && hasServicesToShow(view)
  const adhocShown = props.adhoc?.fold.shown.length ?? 0
  if (!declaredShown && adhocShown === 0) return null
  const services = view?.services ?? []
  const rejections = view?.rejections ?? []

  return (
    <DetailsSection title="Services" count={services.length + adhocShown}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className={HEAD_CELL}>
              <span className="sr-only">Status</span>
            </TableHead>
            <TableHead className={HEAD_CELL}>Name</TableHead>
            <TableHead className={`${HEAD_CELL} ${MID_COLUMN} text-right`}>Port</TableHead>
            <TableHead className={`${HEAD_CELL} ${WIDE_COLUMN}`}>Links</TableHead>
            <TableHead className={`${HEAD_CELL} text-right`}>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {services.map((service) => (
            <Fragment key={service.name}>
              <ServiceRow
                service={service}
                data={props.data}
                preview={props.preview}
                onOpenLog={props.onOpenLog}
              />
              {error?.name === service.name ? <WarningRow text={error.reason} /> : null}
            </Fragment>
          ))}
          {rejections.map((rejection) => (
            <WarningRow
              key={`${rejection.name ?? 'file'}:${rejection.detail}`}
              text={
                rejection.name === undefined
                  ? rejection.detail
                  : `${rejection.name}: ${rejection.detail}`
              }
            />
          ))}
          {props.adhoc === undefined ? null : (
            <AdhocServiceRows data={props.adhoc.data} fold={props.adhoc.fold} />
          )}
        </TableBody>
      </Table>
    </DetailsSection>
  )
}
