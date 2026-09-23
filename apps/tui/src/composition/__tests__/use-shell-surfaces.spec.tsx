import { describe, expect, it } from 'bun:test'
import { testRender } from '@opentui/react/test-utils'
import React, { useState } from 'react'

import { toThreadId } from '@dltech/atlas-core'
import { EShellStatus, toShellId, type ShellSnapshot } from '@dltech/atlas-harness'

import { sameShellSurfaces, useShellSurfaces } from '../use-agents'
import { settle, teardown } from '../../ui/markdown/__tests__/harness'

const THREAD = toThreadId('thread')

const shell = (over: Partial<ShellSnapshot> = {}): ShellSnapshot => ({
  shellId: toShellId('bash_1'),
  threadId: THREAD,
  command: 'bun run dev',
  description: 'dev server',
  status: EShellStatus.Running,
  startedAt: '2026-09-23T12:00:00.000Z',
  lastOutputAt: '2026-09-23T12:00:00.000Z',
  totalCharacters: 0,
  awaitingInput: false,
  ...over,
})

describe('the crew’s shell reading', () => {
  it('reads only identity, owner and status, never the output tallies', () => {
    expect(sameShellSurfaces([shell()], [shell({ totalCharacters: 900 })])).toBe(true)
    expect(sameShellSurfaces([shell()], [shell({ status: EShellStatus.Exited })])).toBe(false)
    expect(sameShellSurfaces([shell()], [shell({ threadId: toThreadId('other') })])).toBe(false)
    expect(sameShellSurfaces([shell()], [])).toBe(false)
  })

  it('holds the same list while only output advances, so the crew never re-renders on chatter', async () => {
    const seen: (readonly ShellSnapshot[])[] = []
    let feed: ((shells: readonly ShellSnapshot[]) => void) | undefined
    const Probe = (): React.ReactNode => {
      const [shells, setShells] = useState<readonly ShellSnapshot[]>([shell()])
      feed = setShells
      seen.push(useShellSurfaces(shells))
      return null
    }

    const setup = await testRender(<Probe />, { width: 10, height: 2 })

    try {
      await setup.flush()
      feed?.([shell({ totalCharacters: 900 })])
      await settle(60)
      await setup.flush()

      expect(seen.length).toBeGreaterThan(0)
      expect(seen[seen.length - 1]).toBe(seen[0])

      feed?.([shell({ status: EShellStatus.Exited })])
      await settle(60)
      await setup.flush()

      expect(seen[seen.length - 1]).not.toBe(seen[0])
      expect(seen[seen.length - 1]?.[0]?.status).toBe(EShellStatus.Exited)
    } finally {
      await teardown(setup)
    }
  })
})
