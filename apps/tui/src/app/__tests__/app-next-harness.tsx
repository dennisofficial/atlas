import { testRender } from '@opentui/react/test-utils'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { StreamSessionRow } from '@dltech/atlas-protocol'

import { frameShowing } from '../../ui/__tests__/waiting'
import { ACCOUNT_FILE_VERSION, writeAccount, type AccountFile } from '../account/account-file'
import { AppNext, type SessionClientFactory } from '../app-next'
import { fakeSessionClient, type FakeSessionClient } from './fake-session-client'
import { sessionRowFixture } from './view-fixture'

const API_URL = 'https://api.example.test'

export const SESSION_ID = 'session-one'

export const WITHIN = 15_000

const ACCOUNT: AccountFile = {
  version: ACCOUNT_FILE_VERSION,
  apiUrl: API_URL,
  email: 'dennis@example.test',
  token: 'token-1',
  preferences: {},
}

export type Mounted = {
  client: () => FakeSessionClient | null
  setup: Awaited<ReturnType<typeof testRender>>
}

export const openSession = async (args?: {
  rows?: readonly StreamSessionRow[]
  width?: number
  height?: number
}): Promise<Mounted> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-app-next-panes-'))
  const accountPath = join(home, 'account.json')
  writeAccount({ path: accountPath, account: ACCOUNT })

  let held: FakeSessionClient | null = null
  const createClient: SessionClientFactory = (clientArgs) => {
    held = fakeSessionClient({ onAuthLost: clientArgs.onAuthLost })
    return held
  }

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
    { width: args?.width ?? 140, height: args?.height ?? 40 },
  )

  await frameShowing({ setup, text: 'listing…', within: WITHIN })
  const mounted: Mounted = { client: () => held, setup }
  const rows = args?.rows ?? [sessionRowFixture({ title: 'the open session' })]
  mounted.client()?.pushRows(rows)
  await frameShowing({ setup, text: rows[0]?.title ?? SESSION_ID, within: WITHIN })
  setup.mockInput.pressEnter()
  await frameShowing({ setup, text: 'esc back', within: WITHIN })

  return mounted
}
