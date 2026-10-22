import { DEFAULT_WARN_PERCENT, EUsageWindow, toAccountId, type AccountUsage } from '@dltech/atlas-core'
import type { AccountUsageService } from '@dltech/atlas-harness'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React from 'react'

import { teardown } from '../../ui/markdown/__tests__/harness'
import { EFooterMeters, type FooterMeter } from '../../ui/usage-meters'
import { useUsageMeters } from '../use-usage-meters'

const WORK = toAccountId('acc_work')

const usageAt = (utilization: number): AccountUsage => ({
  [EUsageWindow.FiveHour]: { utilization, resetsAt: null },
  [EUsageWindow.SevenDay]: null,
})

const serviceOf = (args: {
  active: AccountUsage
  byAccount: Record<string, AccountUsage>
}): AccountUsageService => ({
  snapshot: () => args.active,
  snapshotFor: ({ accountId }) => args.byAccount[accountId] ?? usageAt(0),
  metered: () => true,
  version: () => 0,
  subscribe: () => () => undefined,
  refresh: async () => undefined,
  track: () => undefined,
  stopTracking: () => undefined,
  dispose: () => undefined,
})

async function metersFor(args: {
  usage: AccountUsageService
  metered: boolean
  accountId?: ReturnType<typeof toAccountId>
}): Promise<readonly FooterMeter[]> {
  let seen: readonly FooterMeter[] = []

  function Probe(): React.ReactNode {
    seen = useUsageMeters({
      usage: args.usage,
      metered: args.metered,
      show: EFooterMeters.Session,
      warn: DEFAULT_WARN_PERCENT,
      ...(args.accountId === undefined ? {} : { accountId: args.accountId }),
    })
    return <text>probe</text>
  }

  const setup = await testRender(<Probe />, { width: 20, height: 3 })
  try {
    await setup.flush()
    return seen
  } finally {
    await teardown(setup)
  }
}

const usage = serviceOf({ active: usageAt(11), byAccount: { [WORK]: usageAt(64) } })

describe('useUsageMeters', () => {
  it('reads the account it is told to follow, not the default key', async () => {
    const meters = await metersFor({ usage, metered: true, accountId: WORK })

    expect(meters.map((meter) => meter.text)).toEqual(['64%'])
  })

  it('falls back to the default key while no account is resolved', async () => {
    const meters = await metersFor({ usage, metered: true })

    expect(meters.map((meter) => meter.text)).toEqual(['11%'])
  })

  it('shows nothing for an unmetered provider even with an account', async () => {
    const meters = await metersFor({ usage, metered: false, accountId: WORK })

    expect(meters).toEqual([])
  })
})
