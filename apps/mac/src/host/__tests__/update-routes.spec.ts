import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createDesktopHost, type IDesktopHost } from '../index'
import { EDesktopUpdateState, type IDesktopUpdateStatus } from '../update-routes'

const SECRET = 'b'.repeat(64)
let host: IDesktopHost
let status: IDesktopUpdateStatus = { state: EDesktopUpdateState.Idle }
let restarts = 0
let checks = 0

beforeAll(() => {
  host = createDesktopHost({
    appOrigin: 'http://127.0.0.1:1',
    apiOrigin: 'http://127.0.0.1:1',
    secret: SECRET,
    updates: {
      status: () => status,
      check: async () => {
        checks += 1
        status = { state: EDesktopUpdateState.Ready, version: '1.2.4' }
        return status
      },
      restart: async () => void (restarts += 1),
    },
  })
})

afterAll(async () => {
  await host.stop()
})

async function cookie(): Promise<string> {
  const res = await fetch(`${host.url}/desktop/session?secret=${SECRET}`, {
    redirect: 'manual',
  })
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
}

describe('desktop update routes', () => {
  test('are guarded', async () => {
    expect((await fetch(`${host.url}/desktop/update`)).status).toBe(403)
    const res = await fetch(`${host.url}/desktop/update/restart`, {
      method: 'POST',
    })
    expect(res.status).toBe(403)
    expect(restarts).toBe(0)
    const checked = await fetch(`${host.url}/desktop/update/check`, { method: 'POST' })
    expect(checked.status).toBe(403)
    expect(checks).toBe(0)
  })

  test('report idle then ready with version', async () => {
    const headers = { cookie: await cookie() }
    status = { state: EDesktopUpdateState.Idle }
    expect(await (await fetch(`${host.url}/desktop/update`, { headers })).json()).toEqual({
      state: 'idle',
    })
    status = { state: EDesktopUpdateState.Ready, version: '1.2.3' }
    expect(await (await fetch(`${host.url}/desktop/update`, { headers })).json()).toEqual({
      state: 'ready',
      version: '1.2.3',
    })
  })

  test('check runs the port and reports what it found', async () => {
    const headers = { cookie: await cookie() }
    status = { state: EDesktopUpdateState.Idle }
    const found = await fetch(`${host.url}/desktop/update/check`, { method: 'POST', headers })
    expect(await found.json()).toEqual({ state: 'ready', version: '1.2.4' })
    expect(checks).toBe(1)
  })

  test('restart is refused while idle and calls the port when ready', async () => {
    const headers = { cookie: await cookie() }
    status = { state: EDesktopUpdateState.Idle }
    const refused = await fetch(`${host.url}/desktop/update/restart`, {
      method: 'POST',
      headers,
    })
    expect(refused.status).toBe(409)
    expect(restarts).toBe(0)
    status = { state: EDesktopUpdateState.Ready, version: '1.2.3' }
    const accepted = await fetch(`${host.url}/desktop/update/restart`, {
      method: 'POST',
      headers,
    })
    expect(accepted.status).toBe(202)
    expect(restarts).toBe(1)
  })
})
