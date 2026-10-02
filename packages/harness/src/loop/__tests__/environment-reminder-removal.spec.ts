import { afterEach, describe, expect, it } from 'bun:test'
import { z } from 'zod'

import {
  defaultPipeline,
  EMPTY_PROMPT,
  EExecutionLocation,
  EPortExposure,
  EToolEffect,
} from '@dltech/atlas-core'

import { HookChain } from '../../hooks/registry'
import { scriptedModel } from '../../model/testing/scripted-model'
import { HookedToolDispatcher } from '../../tools/dispatch'
import { InMemoryToolRegistry } from '../../tools/registry'
import { buildHarness, ETurnStatus, type AtlasHarness } from '..'
import { createTempHome, type TempHome } from './temp-home'

const opened: { harness: AtlasHarness; temp: TempHome }[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) {
    await entry.harness.close()
    entry.temp.discard()
  }
})

describe('a turn without recurring environment reminders', () => {
  it.each([EExecutionLocation.Host, EExecutionLocation.Docker, EExecutionLocation.Cloud])(
    'sends only the logged exchange across tool steps on %s',
    async (location) => {
      const model = scriptedModel({
        script: [
          { text: 'checking', calls: [{ callId: 'probe-1', name: 'probe', input: { round: 1 } }] },
          { text: 'checking next', calls: [{ callId: 'probe-2', name: 'probe', input: { round: 2 } }] },
          { text: 'finished' },
        ],
      })
      const registry = new InMemoryToolRegistry([
        {
          name: 'probe',
          description: 'read the next result',
          effect: EToolEffect.Read,
          inputSchema: z.object({ round: z.number() }),
          invoke: async () => ({ ok: true, output: 'ok', modelText: 'ok' }),
        },
      ])
      const temp = createTempHome()
      const staleSources = {
        executionLocation: () => ({ location, mounts: [] }),
        capabilities: () => ({
          canPush: true,
          gitIdentity: 'Operator <operator@example.com>',
          gpgSigning: true,
          dockerAvailable: true,
          persistentFs: true,
          serviceTtlSeconds: null,
          portExposure: EPortExposure.PublicDomain,
          failures: [],
        }),
      }
      const harness = await buildHarness({
        home: temp.home,
        model,
        tools: () => registry.declarations(),
        dispatch: new HookedToolDispatcher({ registry, hooks: new HookChain({}) }),
        assembly: defaultPipeline({
          prompt: () => EMPTY_PROMPT,
          launchDirectory: '/w',
          ...staleSources,
        }),
      })
      opened.push({ harness, temp })
      const thread = await harness.threads.create({ executionLocation: location })

      const outcome = await harness.runner.say({ threadId: thread.id, text: 'check both results' })

      expect(outcome.status).toBe(ETurnStatus.Completed)
      expect(model.doStreamCalls).toHaveLength(3)
      expect(model.doStreamCalls.map((call) => call.prompt.map((message) => message.role))).toEqual([
        ['user', 'user'],
        ['user', 'assistant', 'tool', 'user'],
        ['user', 'assistant', 'tool', 'assistant', 'tool', 'user'],
      ])
      const tails = model.doStreamCalls.map((call) => call.prompt.at(-1))
      for (const tail of tails) {
        expect(tail?.role).toBe('user')
        expect(JSON.stringify(tail)).toContain('Project directory')
      }
      expect(JSON.stringify(model.doStreamCalls)).not.toContain('probed capabilities')
      expect(JSON.stringify(model.doStreamCalls)).not.toContain('You are executing inside')
      const events = await harness.log.read({ threadId: thread.id })
      expect(events.filter((event) => event.type === 'context-loaded')).toEqual([])
      expect(events.filter((event) => event.type === 'location-changed')).toEqual([])
    },
  )
})
