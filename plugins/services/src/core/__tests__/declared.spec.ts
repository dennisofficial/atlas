import { describe, expect, it } from 'bun:test'

import { declarationHash } from '@dltech/atlas-core'

import { declaredOrder, declaredServicesOf } from '../declared'

const read = (content: string) => {
  const parsed = declaredServicesOf(content)
  if (!parsed.ok) throw new Error(`expected a declaration, got: ${parsed.reason}`)
  return parsed.value
}

describe('declared services', () => {
  it('reads a declaration, its names and its hashes', () => {
    const declared = read(
      [
        'services:',
        '  db:',
        '    command: postgres -D /data',
        '  web:',
        '    command: bun dev',
        '    port: 3000',
        '    health: /healthz',
        '    env:',
        '      MODE: dev',
        '    needs:',
        '      - db',
      ].join('\n'),
    )
    expect([...declared.services.keys()]).toEqual(['db', 'web'])
    expect(declared.services.get('web')).toMatchObject({
      command: 'bun dev',
      port: 3000,
      health: '/healthz',
      needs: ['db'],
    })
    const web = declared.services.get('web')
    expect(web && declared.hashes.get('web')).toBe(web && declarationHash(web))
  })

  it('refuses a file with no services key', () => {
    expect(declaredServicesOf('other: true')).toEqual({
      ok: false,
      reason: 'has no services key',
    })
  })

  it('names the service whose entry is bad', () => {
    const parsed = declaredServicesOf(
      ['services:', '  web:', '    command: bun dev', '    port: 99999'].join('\n'),
    )
    expect(parsed.ok).toBe(false)
    expect(parsed.ok ? '' : parsed.reason).toContain('declares "web" badly: port')
  })

  it('refuses a file that is not yaml', () => {
    const parsed = declaredServicesOf('services: [')
    expect(parsed.ok).toBe(false)
  })

  it('refuses an unknown name and lists the declared ones', () => {
    const declared = read(['services:', '  db:', '    command: db'].join('\n'))
    expect(declaredOrder({ declared, name: 'api' })).toEqual({
      ok: false,
      reason: '"api" is not declared in .atlas/services.yaml; declared services: db',
    })
  })

  it('orders a service after the ones it needs', () => {
    const declared = read(
      [
        'services:',
        '  web:',
        '    command: bun dev',
        '    needs:',
        '      - api',
        '  api:',
        '    command: bun serve',
        '    needs:',
        '      - db',
        '  db:',
        '    command: postgres',
      ].join('\n'),
    )
    expect(declaredOrder({ declared, name: 'web' })).toEqual({
      ok: true,
      order: ['db', 'api', 'web'],
    })
  })

  it('refuses a cycle, naming it', () => {
    const declared = read(
      [
        'services:',
        '  a:',
        '    command: a',
        '    needs:',
        '      - b',
        '  b:',
        '    command: b',
        '    needs:',
        '      - a',
      ].join('\n'),
    )
    const ordered = declaredOrder({ declared, name: 'a' })
    expect(ordered.ok).toBe(false)
    expect(ordered.ok ? '' : ordered.reason).toBe(
      'services need each other in a cycle: a -> b -> a',
    )
  })

  it('refuses a need that is not declared', () => {
    const declared = read(
      ['services:', '  web:', '    command: bun dev', '    needs:', '      - db'].join('\n'),
    )
    const ordered = declaredOrder({ declared, name: 'web' })
    expect(ordered.ok).toBe(false)
    expect(ordered.ok ? '' : ordered.reason).toContain('"db" is not declared')
  })
})
