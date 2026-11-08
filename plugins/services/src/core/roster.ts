import { EServiceStatus, type Event, type PluginViewFold, type V2Event } from '@dltech/atlas-core'
import { z } from 'zod'

import './ready-event'

export const SERVICES_VIEW = 'services'

export const serviceRowSchema = z.object({
  serviceId: z.string().min(1),
  name: z.string().optional(),
  command: z.string(),
  port: z.number().int().optional(),
  status: z.enum(EServiceStatus),
  ready: z.boolean(),
  changedAt: z.string(),
})

export const servicesViewSchema = z.array(serviceRowSchema).readonly()

export type ServiceRow = z.infer<typeof serviceRowSchema>
export type ServicesViewState = readonly ServiceRow[]

const upsert = (state: ServicesViewState, row: ServiceRow): ServicesViewState =>
  state.some((kept) => kept.serviceId === row.serviceId)
    ? state.map((kept) => (kept.serviceId === row.serviceId ? row : kept))
    : [...state, row]

const nameOf = (description: string | undefined): { name?: string } =>
  description === undefined || description.trim() === '' ? {} : { name: description }

export const foldServices = (
  state: ServicesViewState,
  event: Event | V2Event,
): ServicesViewState => {
  if (event.type === 'service-started') {
    return upsert(state, {
      serviceId: event.serviceId,
      ...nameOf(event.description),
      command: event.command,
      ...(event.port === undefined ? {} : { port: event.port }),
      status: EServiceStatus.Running,
      ready: false,
      changedAt: event.at,
    })
  }
  if (event.type === 'service-ready') {
    const existing = state.find((kept) => kept.serviceId === event.serviceId)
    return upsert(state, {
      ...(existing ?? {
        serviceId: event.serviceId,
        command: '',
        status: EServiceStatus.Running,
      }),
      ready: true,
      changedAt: event.at,
    })
  }
  if (event.type === 'service-ended') {
    const existing = state.find((kept) => kept.serviceId === event.serviceId)
    return upsert(state, {
      ...(existing ?? {
        serviceId: event.serviceId,
        ...nameOf(event.description),
        command: event.command,
      }),
      status: event.status,
      ready: false,
      changedAt: event.at,
    })
  }
  return state
}

export const servicesView: PluginViewFold<ServicesViewState> = {
  name: SERVICES_VIEW,
  initial: [],
  fold: foldServices,
}

export const servicesOfEvents = (events: readonly (Event | V2Event)[]): ServicesViewState =>
  events.reduce(foldServices, servicesView.initial)
