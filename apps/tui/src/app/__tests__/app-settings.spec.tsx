import { testRender } from '@opentui/react/test-utils'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { frameShowing, frameWhen } from '../../ui/__tests__/waiting'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { accentHex } from '../../ui/accents'
import { resetPalette } from '../../ui/palette-store'
import { theme } from '../../ui/theme'
import {
  ACCOUNT_FILE_VERSION,
  readAccount,
  writeAccount,
  type AccountFile,
} from '../account/account-file'
import { AppNext, type SessionClientFactory } from '../app-next'
import { fakeSessionClient, type FakeSessionClient } from './fake-session-client'

const API_URL = 'https://api.example.test'

const WITHIN = 15_000

const ACCOUNT: AccountFile = {
  version: ACCOUNT_FILE_VERSION,
  apiUrl: API_URL,
  email: 'dennis@example.test',
  token: 'token-1',
  preferences: {},
}

type Mounted = {
  client: () => FakeSessionClient | null
  setup: Awaited<ReturnType<typeof testRender>>
  accountPath: string
  requests: string[]
}

afterEach(() => {
  resetPalette()
})

const open = async (args?: {
  preferences?: Record<string, unknown>
  settings?: readonly { key: string; value: string }[]
  offline?: boolean
}): Promise<Mounted> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-app-settings-'))
  const accountPath = join(home, 'account.json')
  const account: AccountFile = { ...ACCOUNT, preferences: args?.preferences ?? {} }
  writeAccount({ path: accountPath, account })

  const requests: string[] = []
  const fetchFn = (async (input: Parameters<typeof fetch>[0]) => {
    requests.push(String(input))
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch

  let held: FakeSessionClient | null = null
  const createClient: SessionClientFactory = (clientArgs) => {
    const made = fakeSessionClient({ onAuthLost: clientArgs.onAuthLost })
    if (args?.settings !== undefined) made.setSettings(args.settings)
    if (args?.offline === true) made.refuseSettingReads('the account is unreachable')
    held = made
    return made
  }

  const setup = await testRender(
    <AppNext
      accountPath={accountPath}
      initialAccount={account}
      apiUrl={API_URL}
      clientVersion="test"
      openUrl={() => undefined}
      createClient={createClient}
      fetchFn={fetchFn}
      onQuit={() => undefined}
    />,
    { width: 140, height: 40 },
  )

  await frameShowing({ setup, text: 'listing…', within: WITHIN })

  return { client: () => held, setup, accountPath, requests }
}

const openDrawer = async (mounted: Mounted): Promise<void> => {
  mounted.setup.mockInput.pressKey('o', { ctrl: true })
  await frameShowing({ setup: mounted.setup, text: 'Tallest image', within: WITHIN })
}

const IMAGE_ROW = 'Tallest image'

const rowWith = (frame: string, label: string): string =>
  frame.split('\n').find((line) => line.includes(label)) ?? ''

const rowShows = (mounted: Mounted, label: string, text: string): Promise<string> =>
  frameWhen({
    setup: mounted.setup,
    holds: (frame) => rowWith(frame, label).includes(text),
    within: WITHIN,
    describe: `${JSON.stringify(label)} to read ${JSON.stringify(text)}`,
  })

const settled = (mounted: Mounted, holds: () => boolean): Promise<string> =>
  frameWhen({ setup: mounted.setup, holds: () => holds(), within: WITHIN })

const holds = (frame: string, text: string): boolean =>
  frame.toUpperCase().includes(text.toUpperCase())

const showing = async (mounted: Mounted, text: string, within: number): Promise<boolean> => {
  try {
    await frameWhen({ setup: mounted.setup, holds: (frame) => holds(frame, text), within })
    return true
  } catch {
    return false
  }
}

const pageShowing = async (mounted: Mounted, text: string): Promise<void> => {
  for (let step = 0; step < 6; step += 1) {
    if (holds(mounted.setup.captureCharFrame(), text)) return
    mounted.setup.mockInput.pressTab()
    if (await showing(mounted, text, 500)) return
  }
  await frameWhen({
    setup: mounted.setup,
    holds: (frame) => holds(frame, text),
    within: WITHIN,
    describe: `${JSON.stringify(text)} to appear on a page`,
  })
}

describe('the settings drawer', () => {
  test('ctrl+o opens it over the account, without the rows a machine owns', async () => {
    const mounted = await open()

    try {
      await openDrawer(mounted)
      const frame = mounted.setup.captureCharFrame()

      expect(frame).toContain('Tallest image')
      expect(frame).toContain('general')
      expect(frame).not.toContain('Editor')
      expect(frame).not.toContain('Smooth streaming')
    } finally {
      await teardown(mounted.setup)
    }
  })

  test('a row edit writes the account and the row reads its new value', async () => {
    const mounted = await open()

    try {
      await openDrawer(mounted)
      mounted.setup.mockInput.pressEnter()
      await settled(mounted, () => (mounted.client()?.calls.setSetting.length ?? 0) === 1)

      expect(mounted.client()?.calls.setSetting[0]).toEqual({
        key: 'transcript.imageRows',
        value: 'atlas-setting:v1:32',
      })

      const frame = await rowShows(mounted, IMAGE_ROW, '32 rows')
      expect(frame).toContain(IMAGE_ROW)
    } finally {
      await teardown(mounted.setup)
    }
  })

  test('an accent edit lands on the account, repaints, and is cached in the account file', async () => {
    const mounted = await open()

    try {
      await openDrawer(mounted)
      await pageShowing(mounted, 'colour')
      mounted.setup.mockInput.pressEnter()
      await settled(mounted, () => (mounted.client()?.calls.setSetting.length ?? 0) === 1)

      expect(mounted.client()?.calls.setSetting[0]).toEqual({
        key: 'appearance.accent',
        value: 'atlas-setting:v1:"sky"',
      })
      await settled(mounted, () => theme.accent === accentHex('sky'))
      await settled(
        mounted,
        () =>
          readAccount({ path: mounted.accountPath })?.preferences['appearance.accent'] === 'sky',
      )
    } finally {
      await teardown(mounted.setup)
    }
  })

  test('the cloud page shows the signed-in email and signs out', async () => {
    const mounted = await open()

    try {
      await openDrawer(mounted)
      await pageShowing(mounted, 'atlas cloud')
      await frameShowing({ setup: mounted.setup, text: 'dennis@example.test', within: WITHIN })

      mounted.setup.mockInput.pressEnter()
      await settled(mounted, () =>
        mounted.requests.some((url) => url.endsWith('/api/auth/sign-out')),
      )
    } finally {
      await teardown(mounted.setup)
    }
  })

  test('a refused write says so and leaves the row at its old value', async () => {
    const mounted = await open()
    mounted.client()?.refuseSettingWrites('the account refused that')

    try {
      await openDrawer(mounted)
      mounted.setup.mockInput.pressEnter()
      const frame = await frameShowing({
        setup: mounted.setup,
        text: `could not save ${IMAGE_ROW}`,
        within: WITHIN,
      })

      expect(frame).toContain('the account refused that')
      expect(rowWith(frame, IMAGE_ROW)).toContain('30 rows')
      expect(mounted.client()?.calls.setSetting).toHaveLength(1)
      expect(mounted.client()?.calls.removeSetting).toHaveLength(0)
    } finally {
      await teardown(mounted.setup)
    }
  })

  test('the cached palette is on screen before the account answers', async () => {
    const mounted = await open({ preferences: { 'appearance.accent': 'moss' }, offline: true })

    try {
      await frameShowing({ setup: mounted.setup, text: 'listing…', within: WITHIN })
      await settled(mounted, () => theme.accent === accentHex('moss'))
      expect(theme.accent).toBe(accentHex('moss'))
    } finally {
      await teardown(mounted.setup)
    }
  })
})
