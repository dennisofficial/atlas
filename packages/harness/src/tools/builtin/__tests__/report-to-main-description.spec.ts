import { describe, expect, it } from 'bun:test'

import { ReportToMainTool } from '../report-to-main'
import type { AgentRegistrySource } from '../agent-tokens'

const { description } = new ReportToMainTool((() => {
  throw new Error('no registry needed')
}) as AgentRegistrySource)

describe('the report_to_main description', () => {
  it('says a finished turn never reaches the main agent but a failure does', () => {
    expect(description).toContain('Ending your turn never tells it anything')
    expect(description).toContain('Only a failure or a stop reaches it by itself')
  })

  it('no longer promises a relay or describes subtree, service or CI holds', () => {
    expect(description).not.toContain('relays your ending')
    expect(description).not.toContain('subtree')
    expect(description).not.toContain('pull request')
    expect(description).not.toContain('service')
  })
})
