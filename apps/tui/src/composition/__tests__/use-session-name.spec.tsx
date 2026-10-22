import { afterEach, describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'
import { testRender } from '@opentui/react/test-utils'
import React, { act, useRef } from 'react'

import { currentNotices, dismissNotice } from '../../ui/notice-store'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { ERenamed } from '../session-rename'
import type { SessionName } from '../use-session-name'
import { useSessionName } from '../use-session-name'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

const THREAD = toThreadId('session-name-cloud')

type Probe = { sessionName: SessionName | null }

function NameProbe(props: {
  app: FakeApp
  probe: Probe
  readDigest: () => Promise<string>
}): React.ReactNode {
  const started = useRef(true)
  const sessionName = useSessionName({
    app: props.app,
    threadId: THREAD,
    started,
    readDigest: props.readDigest,
    initial: 'debugging background shell completion tracking',
  })
  props.probe.sessionName = sessionName
  return <text>{sessionName.name ?? 'unnamed'}</text>
}

afterEach(() => dismissNotice())

describe('/rename against a transcript it cannot read', () => {
  it('declines with a warning instead of an unhandled rejection', async () => {
    const app = fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: '' } }) })
    const probe: Probe = { sessionName: null }
    const setup = await testRender(
      <NameProbe
        app={app}
        probe={probe}
        readDigest={() =>
          Promise.reject(
            new Error('The read-events request was never answered: the sandbox is parked.'),
          )
        }
      />,
      { width: 80, height: 5 },
    )
    try {
      await setup.flush()
      let outcome: Awaited<ReturnType<SessionName['renameSession']>> | undefined
      await act(async () => {
        outcome = await probe.sessionName?.renameSession('')
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(outcome?.type).toBe(ERenamed.Declined)
      expect(
        currentNotices().some((notice) =>
          notice.text.includes('the rename could not read the transcript'),
        ),
      ).toBe(true)
    } finally {
      await teardown(setup)
    }
  })
})
