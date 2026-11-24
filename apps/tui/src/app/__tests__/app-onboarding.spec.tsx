import { testRender } from '@opentui/react/test-utils'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { frameShowing, frameWhen } from '../../ui/__tests__/waiting'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { resetPalette } from '../../ui/palette-store'
import { ACCOUNT_FILE_VERSION, writeAccount, type AccountFile } from '../account/account-file'
import { AppNext, type SessionClientFactory } from '../app-next'
import { fakeSessionClient } from './fake-session-client'

const API_URL = 'https://api.example.test'

const WITHIN = 15_000

const ACCOUNT: AccountFile = {
  version: ACCOUNT_FILE_VERSION,
  apiUrl: API_URL,
  email: 'dennis@example.test',
  token: 'token-1',
  preferences: {},
}

afterEach(() => {
  resetPalette()
})

const open = async (): Promise<{ setup: Awaited<ReturnType<typeof testRender>> }> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-app-onboarding-'))
  const accountPath = join(home, 'account.json')
  writeAccount({ path: accountPath, account: ACCOUNT })

  const createClient: SessionClientFactory = (clientArgs) =>
    fakeSessionClient({ onAuthLost: clientArgs.onAuthLost, accounts: [] })

  const setup = await testRender(
    <AppNext
      accountPath={accountPath}
      initialAccount={ACCOUNT}
      apiUrl={API_URL}
      clientVersion="test"
      openUrl={() => undefined}
      createClient={createClient}
      onQuit={() => undefined}
    />,
    { width: 140, height: 40 },
  )

  await frameShowing({ setup, text: 'welcome to atlas', within: WITHIN })
  return { setup }
}

describe('the onboarding screen', () => {
  test('greets a signed-in operator with no provider account', async () => {
    const mounted = await open()

    try {
      const frame = await frameShowing({
        setup: mounted.setup,
        text: 'welcome to atlas',
        within: WITHIN,
      })
      expect(frame).toContain('Provider accounts')
      expect(frame).toContain('none yet — connect one')
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)

  test('its first row opens the accounts drawer', async () => {
    const mounted = await open()

    try {
      mounted.setup.mockInput.pressEnter()
      await frameShowing({ setup: mounted.setup, text: 'MODEL PROVIDERS', within: WITHIN })
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)

  test('esc dismisses it for the session', async () => {
    const mounted = await open()

    try {
      mounted.setup.mockInput.pressEscape()
      await frameWhen({
        setup: mounted.setup,
        holds: (frame) => !frame.includes('welcome to atlas'),
        within: WITHIN,
        describe: 'the onboarding screen to close',
      })
      expect(mounted.setup.captureCharFrame()).not.toContain('welcome to atlas')
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)
})
