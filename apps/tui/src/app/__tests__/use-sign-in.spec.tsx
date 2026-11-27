import { createTestRenderer } from '@opentui/core/testing'
import { createRoot } from '@opentui/react'
import { describe, expect, it } from 'bun:test'
import React, { act } from 'react'

import type { LoopbackReturn, LoopbackWait } from '../browser-return/loopback-server'
import type { LoginReturn } from '../account/login-loopback'
import { useSignIn, type SignInControl } from '../account/use-sign-in'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const API_URL = 'https://api.example.test'

const WEB = 'https://byatlas.io'

const USER_CODE = 'ABCD-1234'

const VERIFY_URL = 'https://byatlas.io/device?code=ABCD-1234'

const PORT = 51234

const CODE_OLD = 'code-old'

const CODE_NEW = 'code-new'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

const deferred = <T,>(): Deferred<T> => {
  let resolve: (value: T) => void = () => undefined
  let reject: (reason: unknown) => void = () => undefined
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept
    reject = decline
  })
  return { promise, resolve, reject }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const deviceFetch = (asked: string[]): typeof fetch =>
  (async (input: Parameters<typeof fetch>[0]) => {
    asked.push(String(input))
    if (String(input).endsWith('/api/auth/device/code'))
      return json({
        device_code: 'device-1',
        user_code: USER_CODE,
        verification_uri: 'https://byatlas.io/device',
        verification_uri_complete: VERIFY_URL,
        expires_in: 600,
        interval: 1,
      })
    return new Response('', { status: 404 })
  }) as typeof fetch

const listenerOf = (
  args: LoopbackWait<LoginReturn>,
  code: string,
): LoopbackReturn<LoginReturn> => ({
  port: PORT,
  href: args.spec.hrefOf(PORT),
  outcome: Promise.resolve<LoginReturn | undefined>({ code }),
  stop: () => undefined,
})

const settleFor = async (holds: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (holds()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('the sign-in never got there')
}

type Rig = {
  control: () => SignInControl
  act: (work: () => void | Promise<void>) => Promise<void>
  unmount: () => Promise<void>
}

const mountSignIn = async (input: Parameters<typeof useSignIn>[0]): Promise<Rig> => {
  const setup = await createTestRenderer({ width: 40, height: 4 })
  const root = createRoot(setup.renderer)
  const held: { control: SignInControl | null } = { control: null }

  function Probe(): React.ReactNode {
    const control = useSignIn(input)
    held.control = control
    return <text>{`${control.state.status} ${control.state.failure ?? ''}`}</text>
  }

  await act(async () => {
    root.render(<Probe />)
    await setup.flush()
  })

  const control = (): SignInControl => {
    if (held.control === null) throw new Error('the login probe never rendered')
    return held.control
  }

  return {
    control,
    act: (work) =>
      act(async () => {
        await work()
        await setup.flush()
      }),
    unmount: async () => {
      await act(async () => root.unmount())
      setup.renderer.destroy()
    },
  }
}

type Cancellable = {
  rig: Rig
  held: Deferred<string>
  approved: string[]
  exchanged: string[]
}

const cancellable = async (): Promise<Cancellable> => {
  const held = deferred<string>()
  const approved: string[] = []
  const exchanged: string[] = []
  const starts: number[] = []

  const rig = await mountSignIn({
    apiUrl: API_URL,
    webOrigin: WEB,
    env: {},
    platform: 'darwin',
    openUrl: () => undefined,
    exchange: (login) => {
      exchanged.push(login.code)
      return login.code === CODE_OLD ? held.promise : Promise.resolve('token-new')
    },
    startWait: (args) => {
      starts.push(1)
      return listenerOf(args, starts.length === 1 ? CODE_OLD : CODE_NEW)
    },
    onApproved: (result) => {
      approved.push(result.token)
    },
  })

  await rig.act(() => {
    rig.control().begin()
  })
  await settleFor(() => exchanged.length === 1)

  return { rig, held, approved, exchanged }
}

const startNewer = async (cancelled: Cancellable): Promise<void> => {
  await cancelled.rig.act(() => {
    cancelled.rig.control().stop()
  })
  await cancelled.rig.act(() => {
    cancelled.rig.control().begin()
  })
  await settleFor(() => cancelled.approved.length === 1)
}

describe('the sign-in attempts', () => {
  it('drops an exchange that settles after a newer attempt began', async () => {
    const cancelled = await cancellable()

    await startNewer(cancelled)
    await cancelled.rig.act(() => {
      cancelled.held.resolve('token-old')
    })

    expect(cancelled.exchanged).toEqual([CODE_OLD, CODE_NEW])
    expect(cancelled.approved).toEqual(['token-new'])
    await cancelled.rig.unmount()
  })

  it('drops a failure from an exchange the panel cancelled', async () => {
    const cancelled = await cancellable()

    await startNewer(cancelled)
    await cancelled.rig.act(() => {
      cancelled.held.reject(new Error('the exchange was refused'))
    })

    expect(cancelled.approved).toEqual(['token-new'])
    expect(cancelled.rig.control().state.failure).toBeNull()
    await cancelled.rig.unmount()
  })

  it('stops the device fallback when the panel unmounts while waiting', async () => {
    const asked: string[] = []
    const listener = deferred<LoginReturn | undefined>()
    const stops: number[] = []

    const rig = await mountSignIn({
      apiUrl: API_URL,
      webOrigin: WEB,
      env: {},
      platform: 'darwin',
      openUrl: () => undefined,
      exchange: async () => 'token-1',
      startWait: (args) => ({
        port: PORT,
        href: args.spec.hrefOf(PORT),
        outcome: listener.promise,
        stop: () => {
          stops.push(1)
          listener.resolve(undefined)
        },
      }),
      fetchFn: deviceFetch(asked),
      onApproved: () => undefined,
    })

    await rig.act(() => {
      rig.control().begin()
    })
    await rig.unmount()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(stops).toHaveLength(1)
    expect(asked).toEqual([])
  })

  it('opens no listener when the panel unmounts before the challenge is ready', async () => {
    const starts: number[] = []

    const rig = await mountSignIn({
      apiUrl: API_URL,
      webOrigin: WEB,
      env: {},
      platform: 'darwin',
      openUrl: () => undefined,
      exchange: async () => 'token-1',
      startWait: (args) => {
        starts.push(1)
        return listenerOf(args, CODE_NEW)
      },
      onApproved: () => undefined,
    })

    act(() => {
      rig.control().begin()
    })
    await rig.unmount()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(starts).toEqual([])
  })

  it('falls back to a code when the browser cannot be launched', async () => {
    const asked: string[] = []
    const opened: string[] = []

    const rig = await mountSignIn({
      apiUrl: API_URL,
      webOrigin: WEB,
      env: {},
      platform: 'darwin',
      openUrl: async (url) => {
        opened.push(url)
        return false
      },
      exchange: async () => 'token-1',
      fetchFn: deviceFetch(asked),
      onApproved: () => undefined,
    })

    await rig.act(() => {
      rig.control().begin()
    })
    await settleFor(() => asked.length > 0)

    expect(new URL(opened[0] ?? '').pathname).toBe('/desktop/authorize')
    expect(opened[1]).toBe(VERIFY_URL)
    expect(asked[0]).toContain('/api/auth/device/code')

    await rig.act(() => {
      rig.control().stop()
    })
    await rig.unmount()
  })
})
