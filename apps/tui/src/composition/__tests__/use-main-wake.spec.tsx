import { describe, expect, it } from 'bun:test'
import React, { useState } from 'react'
import { testRender } from '@opentui/react/test-utils'

import { MessageIntake, operatorSource, createPendingQueues } from '@dltech/atlas-harness'

import { useMainWake } from '../use-main-wake'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { fakeAgentRegistry } from './fake-agents'
import { fakeShellRegistry } from './fake-app'
import { fakeServiceRegistry } from './fake-services'
import { THREAD } from './app-fixture'

const settle = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

type Registries = {
  shells: ReturnType<typeof fakeShellRegistry>
  agents: ReturnType<typeof fakeAgentRegistry>
  services: ReturnType<typeof fakeServiceRegistry>
}

const Probe = (props: {
  registries: Registries
  intake: MessageIntake
  canWake: boolean
  onWake: () => void
}): React.ReactNode => {
  useMainWake({
    shells: props.registries.shells,
    agents: props.registries.agents,
    services: props.registries.services,
    threadId: THREAD,
    working: false,
    canWake: props.canWake,
    onWake: props.onWake,
    intake: props.intake,
  })
  return <text>probe</text>
}

const freshRegistries = (): Registries => ({
  shells: fakeShellRegistry(),
  agents: fakeAgentRegistry({ threads: { find: async () => undefined } as never }),
  services: fakeServiceRegistry(),
})

describe('useMainWake over the shared intake', () => {
  it('wakes for a queued message through the one scheduler', async () => {
    const pending = createPendingQueues()
    const intake = new MessageIntake({ sources: [operatorSource(pending)] })

    let wakes = 0
    const setup = await testRender(
      <Probe
        registries={freshRegistries()}
        intake={intake}
        canWake
        onWake={() => {
          wakes += 1
        }}
      />,
      { width: 60, height: 20 },
    )

    try {
      expect(wakes).toBe(0)
      pending.forThread({ threadId: THREAD }).enqueue({ text: 'typed ahead' })
      await settle()
      expect(wakes).toBeGreaterThan(0)
    } finally {
      intake.dispose()
      await teardown(setup)
    }
  })

  it('holds the wake behind a taken keyboard and fires it once the overlay clears', async () => {
    const pending = createPendingQueues()
    const intake = new MessageIntake({ sources: [operatorSource(pending)] })

    let wakes = 0
    const Gate = (): React.ReactNode => {
      const [open, setOpen] = useState(false)
      ;(Gate as unknown as { release: () => void }).release = () => setOpen(true)
      return (
        <Probe
          registries={freshRegistries()}
          intake={intake}
          canWake={open}
          onWake={() => {
            wakes += 1
          }}
        />
      )
    }

    const setup = await testRender(<Gate />, { width: 60, height: 20 })

    try {
      pending.forThread({ threadId: THREAD }).enqueue({ text: 'held behind a prompt' })
      await settle()
      expect(wakes).toBe(0)

      ;(Gate as unknown as { release: () => void }).release()
      await setup.flush()
      await settle()
      expect(wakes).toBeGreaterThan(0)
    } finally {
      intake.dispose()
      await teardown(setup)
    }
  })
})
