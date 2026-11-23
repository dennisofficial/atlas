import { describe, expect, it } from 'bun:test'

import { EAgentStatus, EKilledBy, EServiceStatus } from '@dltech/atlas-core'

import { agentEndedLine } from '../agent-ended-line'
import { serviceEndedLine } from '../service-ended-line'

const service = (killedBy: EKilledBy) =>
  serviceEndedLine({
    serviceId: 'svc_1',
    command: 'bun run dev',
    description: 'web dev server',
    status: EServiceStatus.Killed,
    killedBy,
  })

const agent = (killedBy: EKilledBy) =>
  agentEndedLine({
    agentType: 'builder',
    intent: 'fix the parser',
    status: EAgentStatus.Stopped,
    turns: 4,
    toolCalls: 11,
    killedBy,
  })

describe('a stop line the operator reads', () => {
  it('says atlas stopped a service when the model asked for it', () => {
    expect(service(EKilledBy.Model)).toBe('Service svc_1 "web dev server" was stopped by atlas')
  })

  it('says the operator stopped a service in their own voice', () => {
    expect(service(EKilledBy.User)).toBe('Service svc_1 "web dev server" was stopped by you')
  })

  it('keeps the shared wording for a stop nobody chose', () => {
    expect(service(EKilledBy.SessionEnd)).toBe(
      'Service svc_1 "web dev server" was stopped when the sandbox went to sleep',
    )
  })

  it('says atlas stopped a sub-agent when the model asked for it', () => {
    expect(agent(EKilledBy.Model)).toContain('was stopped by atlas after 4 turns and 11 tool calls')
  })

  it('says the operator stopped a sub-agent in their own voice', () => {
    expect(agent(EKilledBy.User)).toContain('was stopped by you after 4 turns and 11 tool calls')
  })

  it('never tells the operator a stop was at their request', () => {
    for (const killedBy of Object.values(EKilledBy)) {
      expect(service(killedBy)).not.toContain('your request')
      expect(agent(killedBy)).not.toContain('your request')
    }
  })
})
