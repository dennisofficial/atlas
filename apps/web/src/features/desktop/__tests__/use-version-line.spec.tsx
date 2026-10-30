import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { useVersionLine } from '../use-version-line'
import { resetDesktopVersion } from '../version-wire'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const realFetch = globalThis.fetch
const realCommit = process.env.ATLAS_WEB_COMMIT
let calls: string[]

beforeEach(() => {
  calls = []
  resetDesktopVersion()
  process.env.ATLAS_WEB_COMMIT = 'abcdef0123456789'
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0]) => {
      calls.push(String(input))
      return Response.json({ version: '1.42.0', channel: 'stable' })
    },
    { preconnect: realFetch.preconnect },
  )
})
afterEach(() => {
  globalThis.fetch = realFetch
  process.env.ATLAS_WEB_COMMIT = realCommit
  Reflect.deleteProperty(window, 'atlasDesktop')
  document.body.innerHTML = ''
})

function Probe() {
  return <span>{useVersionLine() ?? 'none'}</span>
}

const mount = async () => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<Probe />))
  await act(async () => undefined)
  return () => act(async () => root.unmount())
}

describe('useVersionLine', () => {
  it('shows only the web commit outside the Mac app and never asks the host', async () => {
    const unmount = await mount()
    expect(document.body.textContent).toBe('web abcdef0')
    expect(calls).toEqual([])
    await unmount()
  })

  it('adds the Mac app version from the desktop host', async () => {
    Reflect.set(window, 'atlasDesktop', {})
    const unmount = await mount()
    expect(calls).toEqual(['/desktop/version'])
    expect(document.body.textContent).toBe('Atlas for Mac 1.42.0 · web abcdef0')
    await unmount()
  })
})
