import { describe, expect, test } from 'bun:test'

import { mintEvents } from '@dltech/atlas-client/stream-fixture'

import { frameShowing, frameWhen } from '../../ui/__tests__/waiting'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { openSession, SESSION_ID, WITHIN } from './app-next-harness'

const SHELL_STARTED = mintEvents({
  bodies: [
    { type: 'user-said', text: 'run the tests' },
    {
      type: 'background-shell-started',
      shellId: 'sh-1',
      command: 'bun test',
      description: 'the test run',
    },
  ],
})

describe('the shells drawer', () => {
  test('ctrl+t shows the tail, and esc closes it without leaving the session', async () => {
    const mounted = await openSession()

    try {
      mounted.client()?.pushEvents({ sessionId: SESSION_ID, events: SHELL_STARTED, live: true })
      mounted.client()?.pushShellOutput({
        sessionId: SESSION_ID,
        shellId: 'sh-1',
        offset: 0,
        text: 'printed the tail',
      })
      await frameShowing({ setup: mounted.setup, text: 'the test run', within: WITHIN })

      mounted.setup.mockInput.pressKey('t', { ctrl: true })
      const open = await frameShowing({
        setup: mounted.setup,
        text: 'printed the tail',
        within: WITHIN,
      })
      expect(open).toContain('the test run')
      expect(open).not.toContain('stop it')

      mounted.setup.mockInput.pressEscape()
      const closed = await frameWhen({
        setup: mounted.setup,
        holds: (frame) => !frame.includes('printed the tail'),
        within: WITHIN,
        describe: 'the drawer to close',
      })
      expect(closed).toContain('run the tests')
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)

  test('q closes the drawer too', async () => {
    const mounted = await openSession()

    try {
      mounted.client()?.pushEvents({ sessionId: SESSION_ID, events: SHELL_STARTED, live: true })
      await frameShowing({ setup: mounted.setup, text: 'the test run', within: WITHIN })

      mounted.setup.mockInput.pressKey('t', { ctrl: true })
      await frameShowing({ setup: mounted.setup, text: 'SHELL LOG', within: WITHIN })

      mounted.setup.mockInput.pressKey('q')
      await frameWhen({
        setup: mounted.setup,
        holds: (frame) => !frame.includes('SHELL LOG'),
        within: WITHIN,
        describe: 'the drawer to close',
      })
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)
})
