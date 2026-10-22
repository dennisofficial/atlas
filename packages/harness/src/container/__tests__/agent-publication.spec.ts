import { afterEach, describe, expect, it } from 'bun:test'

import { EWebSearchBackend } from '@dltech/atlas-core'

import { AgentRegistryPort } from '../../agents/registry/port'
import { createDeltaChannel } from '../../channel/delta-channel'
import { recorder } from '../../channel/__tests__/signals'
import { createTempHome, type TempHome } from '../../loop/__tests__/temp-home'
import { scriptedModel } from '../../model/testing/scripted-model'
import { ServiceRegistryPort } from '../../services/service-registry'
import { ThreadStorePort } from '../../store'
import { createHarnessContainer } from '../create-harness-container'
import { registeredPortToken } from '../injection'
import {
  DeltaChannelToken,
  LanguageModelToken,
  WebSearchBackendToken,
  WorktreeDirectoryToken,
  WorkspaceRoot,
} from '../tokens'

const ROOT = '/workspace/atlas'

const opened: {
  temp: TempHome
  previousHome: string | undefined
  services: ServiceRegistryPort
}[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) {
    await entry.services.closeAll()
    if (entry.previousHome === undefined) delete process.env['ATLAS_HOME']
    else process.env['ATLAS_HOME'] = entry.previousHome
    entry.temp.discard()
  }
})

describe('the agent supervisor composed into the container', () => {
  it('publishes events-appended to the parent thread when it records a spawn', async () => {
    const temp = createTempHome()
    const previousHome = process.env['ATLAS_HOME']
    process.env['ATLAS_HOME'] = temp.home

    const container = createHarnessContainer()
    container.register(WorkspaceRoot, { useValue: ROOT })
    container.register(LanguageModelToken, { useValue: scriptedModel({ script: [] }) })
    container.register(WorktreeDirectoryToken, { useValue: () => '.atlas/worktrees' })
    container.register(WebSearchBackendToken, { useValue: () => EWebSearchBackend.DuckDuckGo })
    const channel = createDeltaChannel()
    container.register(DeltaChannelToken, { useValue: channel })
    const services = container.resolve(registeredPortToken(ServiceRegistryPort))
    opened.push({ temp, previousHome, services })

    const threads = container.resolve(registeredPortToken(ThreadStorePort))
    const parent = (await threads.create({ workspace: ROOT, repo: null })).id
    const { seen, listener } = recorder()
    channel.subscribe({ threadId: parent, listener })

    const agents = container.resolve(registeredPortToken(AgentRegistryPort))
    await agents.spawn({
      threadId: parent,
      agentType: 'explore',
      brief: 'look',
      intent: 'looking',
    })

    expect(seen.some((signal) => signal.type === 'events-appended')).toBe(true)
  })
})
