import { describe, expect, it } from 'bun:test'

import { EContextSlot, EStage, type AssembledMessage } from '@dltech/atlas-core'

import { THREAD, rigOf } from '../../__tests__/exit-fixture'
import { HookChain } from '../../hooks/registry'
import { FakeTool, InMemoryModelContext } from '../../testing'
import { PauseSignal } from '../pause-signal'
import { ETurnStatus } from '../turn-outcome'

const INSTRUCTIONS = 'acme server: prefer the docs tool'

const instructionsHook = (offered: Set<string>) => ({
  name: 'mcp-instructions',
  order: { stage: EStage.Observe, nudge: 20 },
  run: async () => {
    if (offered.has('acme')) return {}
    offered.add('acme')
    return {
      drafts: [
        {
          type: 'context-loaded' as const,
          slot: EContextSlot.McpInstructions,
          key: 'acme',
          content: INSTRUCTIONS,
        },
      ],
    }
  },
})

const durable = (messages: readonly AssembledMessage[]): readonly unknown[] =>
  messages.filter((message) => message.volatile !== true)

const messageText = (message: unknown): string => JSON.stringify(message)

const firstDifference = ({
  earlier,
  later,
}: {
  earlier: readonly unknown[]
  later: readonly unknown[]
}): number | undefined => {
  const shared = Math.min(earlier.length, later.length)
  for (let index = 0; index < shared; index += 1) {
    if (messageText(earlier[index]) !== messageText(later[index])) return index
  }
  return earlier.length <= later.length ? undefined : shared
}

const pausedRig = ({ offered }: { offered: Set<string> }) => {
  const pause = new PauseSignal()
  const tool = new FakeTool('read', 'contents', () => pause.pause())
  const rig = rigOf({
    script: [{ calls: [{ callId: 'c1', name: 'read', input: {} }] }, { text: 'never reached' }],
    tools: [tool],
    overrides: { hooks: new HookChain({ beforeTurn: [instructionsHook(offered)] }) },
  })
  return { rig, pause, tool }
}

const resumedRig = ({
  paused,
  tool,
  offered,
}: {
  paused: ReturnType<typeof pausedRig>['rig']
  tool: FakeTool
  offered: Set<string>
}) =>
  rigOf({
    script: [{ text: 'again' }],
    tools: [tool],
    overrides: {
      record: paused.record,
      modelContext: new InMemoryModelContext(paused.record),
      hooks: new HookChain({ beforeTurn: [instructionsHook(offered)] }),
    },
  })

describe('a turn resumed on a host that forgot what it already recorded', () => {
  it('sends the paused turn messages again instead of moving the context to the tail', async () => {
    const { rig, pause, tool } = pausedRig({ offered: new Set<string>() })

    const pausedOutcome = await rig.runner.say({ threadId: THREAD, text: 'go', pause })
    expect(pausedOutcome.status).toBe(ETurnStatus.HandoffPaused)

    const resumed = resumedRig({ paused: rig, tool, offered: new Set<string>() })
    await resumed.runner.resume({ threadId: THREAD })

    const earlier = durable(rig.model.requests[0]?.assembled.messages ?? [])
    const later = durable(resumed.model.requests[0]?.assembled.messages ?? [])
    const differing = firstDifference({ earlier, later })

    expect(differing).toBeUndefined()
  })

  it('records the same instructions once when the host forgot them', async () => {
    const { rig, pause, tool } = pausedRig({ offered: new Set<string>() })

    await rig.runner.say({ threadId: THREAD, text: 'go', pause })

    const resumed = resumedRig({ paused: rig, tool, offered: new Set<string>() })
    await resumed.runner.resume({ threadId: THREAD })

    const loaded = rig.record
      .eventsOf(THREAD)
      .filter((event) => event.type === 'context-loaded' && event.key === 'acme')
    expect(loaded).toHaveLength(1)
  })
})
