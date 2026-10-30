import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { EClientRequest } from '@dltech/atlas-client/channel'

import type { RosterChannel } from '../roster-source'
import { useDeclaredServices, type DeclaredServicesData } from '../use-declared-services'
import { fakeChannel, rosterOf, settle, unmountAll } from './processes-fixture'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(unmountAll)

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const VIEW = {
  services: [{ name: 'web', state: 'stopped', links: [] }],
  rejections: [],
}

async function mountDeclared(channel: RosterChannel) {
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.createElement('div'))
  let latest: DeclaredServicesData | null = null
  function Probe() {
    latest = useDeclaredServices(channel)
    return null
  }
  await act(async () => root.render(<Probe />))
  return {
    data: () => {
      if (latest === null) throw new Error('the probe never rendered')
      return latest
    },
    unmount: () => act(async () => root.unmount()),
  }
}

describe('useDeclaredServices', () => {
  it('loads the view on mount and refetches on each roster push', async () => {
    const fake = fakeChannel((call) =>
      call.op === EClientRequest.ListDeclaredServices ? { ok: true, view: VIEW } : null,
    )
    const mounted = await mountDeclared(fake.channel)
    await settle()
    expect(mounted.data().view?.services.map((entry) => entry.name)).toEqual(['web'])
    const before = fake.callsOf(EClientRequest.ListDeclaredServices).length
    await fake.push(rosterOf({}))
    await settle()
    expect(fake.callsOf(EClientRequest.ListDeclaredServices).length).toBeGreaterThan(before)
    await mounted.unmount()
  })

  it('start ensures just that name and a refusal lands on the row', async () => {
    const fake = fakeChannel((call) =>
      call.op === EClientRequest.EnsureDeclaredServices
        ? { ok: false, reason: 'port taken' }
        : { ok: true, view: VIEW },
    )
    const mounted = await mountDeclared(fake.channel)
    await settle()
    await act(async () => mounted.data().handleStart('web'))
    expect(fake.callsOf(EClientRequest.EnsureDeclaredServices)[0]?.params).toEqual({
      names: ['web'],
    })
    expect(mounted.data().error).toEqual({ name: 'web', reason: 'port taken' })
    expect(mounted.data().busyName).toBeNull()
    await mounted.unmount()
  })
})
