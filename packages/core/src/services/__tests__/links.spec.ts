import { describe, expect, it } from 'bun:test'

import { declaredLinks, resolveLinks, serviceDeclarationSchema } from '../declaration'

describe('declaredLinks', () => {
  it('is empty without portals', () => {
    expect(declaredLinks({ name: 'web' })).toEqual([])
  })

  it('maps portal true to the root link titled by the service', () => {
    expect(declaredLinks({ name: 'web', portal: true })).toEqual([{ url: '/', title: 'web' }])
  })

  it('applies object defaults and lists the primary first', () => {
    expect(
      declaredLinks({
        name: 'web',
        portal: { title: 'App' },
        portals: [{ url: '/docs', title: 'Docs', description: 'd' }],
      }),
    ).toEqual([
      { url: '/', title: 'App' },
      { url: '/docs', title: 'Docs', description: 'd' },
    ])
  })
})

describe('resolveLinks', () => {
  it('joins relative paths onto the public url and keeps absolute ones', () => {
    expect(
      resolveLinks({
        links: [
          { url: '/', title: 'a' },
          { url: '/docs', title: 'b' },
          { url: 'https://x.dev/y', title: 'c' },
        ],
        publicUrl: 'https://p.dev/',
      }).map((link) => link.url),
    ).toEqual(['https://p.dev/', 'https://p.dev/docs', 'https://x.dev/y'])
  })
})

describe('setup and portals schema', () => {
  it('accepts setup and portals', () => {
    expect(
      serviceDeclarationSchema.safeParse({
        command: 'x',
        setup: ['bun i'],
        portals: [{ url: '/a', title: 'A' }],
      }).success,
    ).toBe(true)
  })

  it('rejects empty setup and bad link urls', () => {
    expect(serviceDeclarationSchema.safeParse({ command: 'x', setup: [] }).success).toBe(false)
    expect(
      serviceDeclarationSchema.safeParse({
        command: 'x',
        portals: [{ url: 'docs', title: 'A' }],
      }).success,
    ).toBe(false)
    expect(
      serviceDeclarationSchema.safeParse({
        command: 'x',
        portal: { url: 'docs' },
      }).success,
    ).toBe(false)
  })
})
