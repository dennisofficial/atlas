import { testRender } from '@opentui/react/test-utils'
import { afterEach } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { frameShowing } from '../../ui/__tests__/waiting'
import { resetPalette } from '../../ui/palette-store'
import { ACCOUNT_FILE_VERSION, writeAccount, type AccountFile } from '../account/account-file'
import { AppNext, type SessionClientFactory } from '../app-next'
import { fakeSessionClient, type FakeSessionClient } from './fake-session-client'

export const API_URL = 'https://api.example.test'

export const WITHIN = 15_000

const ACCOUNT: AccountFile = {
  version: ACCOUNT_FILE_VERSION,
  apiUrl: API_URL,
  email: 'dennis@example.test',
  token: 'token-1',
  preferences: {},
}

export type Mounted = {
  client: () => FakeSessionClient
  setup: Awaited<ReturnType<typeof testRender>>
  opened: string[]
}

export const openApp = async (args?: {
  configure?: (client: FakeSessionClient) => void
  env?: Record<string, string | undefined>
  platform?: string
}): Promise<Mounted> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-app-accounts-'))
  const accountPath = join(home, 'account.json')
  writeAccount({ path: accountPath, account: ACCOUNT })

  const opened: string[] = []
  let held: FakeSessionClient | null = null
  const createClient: SessionClientFactory = (clientArgs) => {
    const made = fakeSessionClient({ onAuthLost: clientArgs.onAuthLost, accounts: [] })
    held = made
    return made
  }

  const setup = await testRender(
    <AppNext
      accountPath={accountPath}
      initialAccount={ACCOUNT}
      apiUrl={API_URL}
      clientVersion="test"
      openUrl={(url) => void opened.push(url)}
      env={args?.env ?? { SSH_CONNECTION: 'ssh' }}
      platform={args?.platform ?? 'linux'}
      createClient={createClient}
      onQuit={() => undefined}
    />,
    { width: 140, height: 40 },
  )

  await frameShowing({ setup, text: 'welcome to atlas', within: WITHIN })
  const mounted = { client: () => held as FakeSessionClient, setup, opened }
  args?.configure?.(mounted.client())
  return mounted
}

export const openDrawer = async (mounted: Mounted): Promise<void> => {
  mounted.setup.mockInput.pressKey('a', { ctrl: true })
  await frameShowing({ setup: mounted.setup, text: 'MODEL PROVIDERS', within: WITHIN })
}

export const resetPaletteAfterEach = (): void => {
  afterEach(() => {
    resetPalette()
  })
}
