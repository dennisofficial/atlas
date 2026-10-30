'use client'

import {
  CircleIcon,
  CircleXIcon,
  LoaderCircleIcon,
  PlayIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  SquareIcon,
  TriangleAlertIcon,
} from 'lucide-react'

import { DetailRow } from '@dltech/atlas-ui/ai/detail-row'
import type { DeclaredServiceStateWire, DeclaredServiceViewWire } from '@dltech/atlas-wire/web'

import {
  hasServicesToShow,
  linkSplitOf,
  restartEmphasizedOf,
  serviceActionsOf,
  serviceStateLabelOf,
} from '../../data/services-model'
import type { DeclaredServicesData } from '../../data/use-declared-services'
import type { ProcessesData } from '../../data/use-processes'
import { ActionButton } from './action-button'
import { AdhocServiceRows, type AdhocFold } from './processes-sections'
import { DetailsSection } from './section'

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
  onOpenLog: (serviceId: string) => void
}) {
  const { service, data, onOpenLog } = props
  const { name, state, serviceId } = service
  const actions = serviceActionsOf(state)
  const busy = data.busyName !== null
  const reason = service.reason ?? undefined
  return (
    <DetailRow
      mono
      icon={<StateIcon state={state} />}
      label={name}
      detail={
        <>
          {serviceStateLabelOf(state)}
          {reason === undefined ? null : ` · ${reason}`}
          {service.links.length === 0 && service.url === undefined ? null : ' · '}
          <ServiceLinks service={service} />
        </>
      }
      actions={
        <>
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
        </>
      }
    />
  )
}

function WarningRow({ text }: { text: string }) {
  return (
    <DetailRow
      icon={<TriangleAlertIcon aria-hidden className="size-3.5 text-warning" />}
      label={<span className="text-xs whitespace-normal">{text}</span>}
    />
  )
}

export type AdhocServices = { data: ProcessesData; fold: AdhocFold }

export function ServicesSection(props: {
  data: DeclaredServicesData
  onOpenLog: (serviceId: string) => void
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
      {services.map((service) => (
        <div key={service.name} className="flex flex-col">
          <ServiceRow service={service} data={props.data} onOpenLog={props.onOpenLog} />
          {error?.name === service.name ? <WarningRow text={error.reason} /> : null}
        </div>
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
    </DetailsSection>
  )
}
