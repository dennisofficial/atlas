import { describe, expect, it } from 'bun:test'

import { groupThreadsIntoSessions } from '../grouping'

describe('groupThreadsIntoSessions', () => {
  it('groups agent threads under their highest non-agent ancestor and keeps forks as roots', () => {
    const { sessions, orphanedAgents } = groupThreadsIntoSessions({
      threads: [
        { id: 'root', spawnerThreadId: null },
        { id: 'agent', spawnerThreadId: 'root' },
        { id: 'subagent', spawnerThreadId: 'agent' },
        { id: 'fork', spawnerThreadId: null },
      ],
    })
    expect(sessions.get('root')).toEqual(['root', 'agent', 'subagent'])
    expect(sessions.get('fork')).toEqual(['fork'])
    expect(orphanedAgents).toEqual([])
  })

  it('makes an agent with a missing spawner its own session and reports it', () => {
    const { sessions, orphanedAgents } = groupThreadsIntoSessions({
      threads: [{ id: 'stray', spawnerThreadId: 'gone' }],
    })
    expect(sessions.get('stray')).toEqual(['stray'])
    expect(orphanedAgents).toEqual(['stray'])
  })

  it('breaks supervision cycles by orphaning the starting thread', () => {
    const { sessions, orphanedAgents } = groupThreadsIntoSessions({
      threads: [
        { id: 'a', spawnerThreadId: 'b' },
        { id: 'b', spawnerThreadId: 'a' },
      ],
    })
    expect(sessions.get('a')).toEqual(['a'])
    expect(sessions.get('b')).toEqual(['b'])
    expect(orphanedAgents.sort()).toEqual(['a', 'b'])
  })
})
