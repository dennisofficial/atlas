import { describe, expect, it } from 'bun:test'

import type { DeclaredServiceViewWire, ServiceSnapshotWire } from '@dltech/atlas-wire/web'

import {
  declaredNamesOf,
  hasServicesToShow,
  linkSplitOf,
  restartEmphasizedOf,
  sameViewOf,
  serviceActionsOf,
  serviceStateLabelOf,
  undeclaredServicesOf,
} from '../services-model'

const view = (over: Partial<DeclaredServiceViewWire> = {}): DeclaredServiceViewWire => ({
  name: 'web',
  state: 'running',
  links: [],
  ...over,
})

describe('services model', () => {
  it('maps every state to its actions', () => {
    expect(serviceActionsOf('stopped')).toEqual({ start: true, restart: false, stop: false })
    expect(serviceActionsOf('starting')).toEqual({ start: false, restart: false, stop: true })
    expect(serviceActionsOf('running')).toEqual({ start: false, restart: true, stop: true })
    expect(serviceActionsOf('stale')).toEqual({ start: false, restart: true, stop: true })
    expect(serviceActionsOf('failed')).toEqual({ start: true, restart: false, stop: false })
    expect(serviceActionsOf('crash-looping')).toEqual({ start: true, restart: false, stop: false })
  })

  it('labels states and emphasizes restart only when stale', () => {
    expect(serviceStateLabelOf('stale')).toBe('config changed')
    expect(serviceStateLabelOf('crash-looping')).toBe('crash looping')
    expect(restartEmphasizedOf('stale')).toBe(true)
    expect(restartEmphasizedOf('running')).toBe(false)
  })

  it('hides the section without declarations or rejections', () => {
    expect(hasServicesToShow(null)).toBe(false)
    expect(hasServicesToShow({ services: [], rejections: [] })).toBe(false)
    expect(hasServicesToShow({ services: [], rejections: [{ detail: 'bad yaml' }] })).toBe(true)
    expect(hasServicesToShow({ services: [view()], rejections: [] })).toBe(true)
  })

  it('removes declared services from the generic list', () => {
    const snapshot = (name: string | undefined) =>
      ({ serviceId: name ?? 'x', name }) as ServiceSnapshotWire
    const declared = declaredNamesOf({ services: [view()], rejections: [] })
    expect(
      undeclaredServicesOf({
        services: [snapshot('web'), snapshot('db'), snapshot(undefined)],
        declared,
      }).map((entry) => entry.serviceId),
    ).toEqual(['db', 'x'])
  })

  it('shows the first link inline and the rest as extras, none when failed', () => {
    const links = [
      { url: 'https://a', title: 'App' },
      { url: 'https://b', title: 'Docs' },
    ]
    expect(linkSplitOf(view({ links })).inline?.title).toBe('App')
    expect(linkSplitOf(view({ links })).extra).toHaveLength(1)
    expect(linkSplitOf(view({ url: 'https://c' })).inline?.url).toBe('https://c')
    expect(linkSplitOf(view({ links, reason: 'boom' })).inline).toBeUndefined()
  })

  it('treats equal views as the same', () => {
    const a = { services: [view()], rejections: [] }
    expect(sameViewOf({ previous: a, next: { services: [view()], rejections: [] } })).toBe(true)
    expect(sameViewOf({ previous: null, next: a })).toBe(false)
  })
})
