import { describe, expect, it } from 'bun:test'

import { agentHrefOf, agentParamOf, agentSearchOf, parentAgentParamOf } from '../agent-search'

describe('agentParamOf', () => {
  it('reads the agent id from the query', () => {
    expect(agentParamOf(new URLSearchParams('agent=agent-1'))).toBe('agent-1')
  })

  it('treats a missing or empty agent as no selection', () => {
    expect(agentParamOf(new URLSearchParams(''))).toBeUndefined()
    expect(agentParamOf(new URLSearchParams('agent='))).toBeUndefined()
  })
})

describe('parentAgentParamOf', () => {
  it('reads the sub-agent that opened a nested agent', () => {
    expect(parentAgentParamOf(new URLSearchParams('agent=child&parent=agent-1'))).toBe('agent-1')
  })

  it('treats a missing or empty parent as the session', () => {
    expect(parentAgentParamOf(new URLSearchParams('agent=agent-1'))).toBeUndefined()
    expect(parentAgentParamOf(new URLSearchParams('agent=agent-1&parent='))).toBeUndefined()
  })
})

describe('agentSearchOf', () => {
  it('sets the agent beside the other params', () => {
    const next = agentSearchOf({ search: new URLSearchParams('tab=files'), agentId: 'agent-7' })
    expect(next.toString()).toBe('tab=files&agent=agent-7')
  })

  it('records the sub-agent that opened a nested agent', () => {
    const next = agentSearchOf({
      search: new URLSearchParams(),
      agentId: 'thr_grandchild',
      parentAgentId: 'thr_child',
    })
    expect(next.toString()).toBe('agent=thr_grandchild&parent=thr_child')
  })

  it('drops the parent when the agent is not nested', () => {
    const next = agentSearchOf({
      search: new URLSearchParams('agent=thr_grandchild&parent=thr_child'),
      agentId: 'thr_child',
    })
    expect(next.toString()).toBe('agent=thr_child')
  })

  it('removes the agent and the parent, and keeps the other params', () => {
    const next = agentSearchOf({
      search: new URLSearchParams('tab=files&agent=agent-7&parent=agent-1'),
      agentId: undefined,
    })
    expect(next.toString()).toBe('tab=files')
  })
})

describe('agentHrefOf', () => {
  it('drops the query when nothing else rides along', () => {
    expect(
      agentHrefOf({
        pathname: '/sessions/ses-1',
        search: new URLSearchParams(),
        agentId: undefined,
      }),
    ).toBe('/sessions/ses-1')
  })

  it('links the agent into the session url', () => {
    expect(
      agentHrefOf({
        pathname: '/sessions/ses-1',
        search: new URLSearchParams(''),
        agentId: 'agent-7',
      }),
    ).toBe('/sessions/ses-1?agent=agent-7')
  })

  it('round-trips a nested agent back to its parent', () => {
    const nested = agentHrefOf({
      pathname: '/sessions/ses-1',
      search: new URLSearchParams(''),
      agentId: 'thr_grandchild',
      parentAgentId: 'thr_child',
    })
    expect(nested).toBe('/sessions/ses-1?agent=thr_grandchild&parent=thr_child')

    const search = new URLSearchParams(nested.split('?')[1] ?? '')
    expect(agentParamOf(search)).toBe('thr_grandchild')
    expect(parentAgentParamOf(search)).toBe('thr_child')

    const back = agentHrefOf({
      pathname: '/sessions/ses-1',
      search,
      agentId: parentAgentParamOf(search),
    })
    expect(back).toBe('/sessions/ses-1?agent=thr_child')
  })
})
