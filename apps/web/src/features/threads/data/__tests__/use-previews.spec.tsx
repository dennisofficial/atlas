import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { EServiceStatus, type RosterWire } from '@dltech/atlas-wire/web'

import type { RosterChannel } from '../roster-source'
import { type PreviewsState, usePreviews } from '../use-previews'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const serviceOn = (args: { id: string; port: number }) => ({
  serviceId: args.id,
  command: `serve ${args.id}`,
  description: args.id,
  status: EServiceStatus.Running,
  logPath: `/tmp/${args.id}.log`,
  startedAt: `2026-11-04T10:00:0${args.port % 10}Z`,
  exposure: {
    containerPort: args.port,
    hostPort: args.port,
    url: `https://${args.port}.example.dev`,
  },
})

const roster: RosterWire = {
  shells: [],
  agents: [],
  services: [serviceOn({ id: 'api', port: 3001 }), serviceOn({ id: 'web', port: 3002 })],
}

const channel: RosterChannel = {
  request: async () => roster,
  onRoster: () => () => undefined,
}

async function mount(threadId: string) {
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.createElement('div'))
  let latest: PreviewsState | null = null
  function Probe() {
    latest = usePreviews({ channel, threadId })
    return null
  }
  await act(async () => root.render(<Probe />))
  const state = () => {
    if (latest === null) throw new Error('the probe never rendered')
    return latest
  }
  state.unmount = () => act(async () => root.unmount())
  return state
}

describe('usePreviews', () => {
  it('restores the selected preview when the same thread mounts again', async () => {
    const first = await mount('previews-remembered')
    const other = first().ports.find((port) => port.id !== first().selectedId)
    if (other === undefined) throw new Error('expected two preview ports')
    await act(async () => first().select(other.id))
    await first.unmount()
    const again = await mount('previews-remembered')
    expect(again().selectedId).toBe(other.id)
  })

  it('restores a link opened in the preview', async () => {
    const first = await mount('previews-link')
    const target = first().ports[1]
    if (target === undefined) throw new Error('expected two preview ports')
    const url = `${target.url}/login`
    await act(async () => first().openUrl({ portId: target.id, url }))
    await first.unmount()
    const again = await mount('previews-link')
    expect(again().selectedId).toBe(target.id)
    expect(again().src).toBe(url)
  })
})
