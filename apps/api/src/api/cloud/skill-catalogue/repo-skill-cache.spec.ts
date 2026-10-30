import { describe, expect, it } from 'bun:test'
import { RepoSkillCache } from './repo-skill-cache'

const skills = [{ name: 'a', summary: 's' }]

describe('RepoSkillCache', () => {
  it('evicts the least recently used key past capacity', () => {
    const cache = new RepoSkillCache(2)
    cache.set({ key: 'one', skills })
    cache.set({ key: 'two', skills })
    cache.get('one')
    cache.set({ key: 'three', skills })
    expect(cache.get('two')).toBeUndefined()
    expect(cache.get('one')).toBe(skills)
    expect(cache.get('three')).toBe(skills)
  })
})
