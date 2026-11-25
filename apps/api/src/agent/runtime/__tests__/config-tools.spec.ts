import { describe, expect, it } from 'bun:test'

import {
  fakeCloudConfig,
  fakePersonalConfig,
} from '../../agent-tools/__tests__/support-cloud-config'
import type { CloudConfigStore } from '../../config/cloud-config-store'
import { configToolsOf } from '../config-tools'

const storeOf = (): CloudConfigStore => {
  const project = fakeCloudConfig().client
  const personal = fakePersonalConfig().client
  return { forProject: () => project, forPersonal: () => personal }
}

describe('configToolsOf', () => {
  it('offers cloud_config and mcp_edit for a session with a project', () => {
    const tools = configToolsOf({ store: storeOf(), projectId: 'prj_1', userId: 'user-1' })

    expect(tools.map((tool) => tool.name)).toEqual(['cloud_config', 'mcp-edit'])
  })

  it('offers cloud_config alone for a session without a project', () => {
    const tools = configToolsOf({ store: storeOf(), projectId: null, userId: 'user-1' })

    expect(tools.map((tool) => tool.name)).toEqual(['cloud_config'])
  })

  it('offers nothing without a store', () => {
    expect(configToolsOf({ store: undefined, projectId: 'prj_1', userId: 'user-1' })).toEqual([])
  })
})
