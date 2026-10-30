import { describe, expect, it } from 'bun:test'

import { toThreadId, deriveServicePort } from '@dltech/atlas-core'

import {
  EServiceRejection,
  loadDeclaredServices,
  parseDeclaredServices,
} from '../declared-services'
import { allocateServicePort } from '../service-port'

const THREAD = toThreadId('thread-1')

describe('loadDeclaredServices', () => {
  it('treats a missing file as empty', async () => {
    const read = () => Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' }))
    expect(await loadDeclaredServices({ root: '/r', read })).toEqual({
      services: [],
      rejections: [],
    })
  })

  it('reports an unreadable file', async () => {
    const read = () => Promise.reject(new Error('denied'))
    const result = await loadDeclaredServices({ root: '/r', read })
    expect(result.rejections[0]?.rejection).toBe(EServiceRejection.Unreadable)
  })

  it('parses services and keeps valid siblings of a bad entry', async () => {
    const text = [
      'services:',
      '  web:',
      '    command: bun dev',
      '    portal: true',
      '    env:',
      '      FOO: bar',
      '  broken:',
      '    command: x',
      '    env:',
      '      PORT: "1"',
      '  Bad_Name:',
      '    command: x',
    ].join('\n')
    const result = await loadDeclaredServices({ root: '/r', read: async () => text })
    expect(result.services.map((service) => service.name)).toEqual(['web'])
    expect(result.rejections.map((r) => [r.name, r.rejection])).toEqual([
      ['broken', EServiceRejection.BadEntry],
      ['Bad_Name', EServiceRejection.BadName],
    ])
    expect(result.rejections[0]?.definedIn).toBe('/r/.atlas/services.yaml')
  })
})

describe('parseDeclaredServices', () => {
  it('rejects a syntax error and a missing services map', () => {
    expect(parseDeclaredServices({ text: 'a: [', file: 'f' }).rejections[0]?.rejection).toBe(
      EServiceRejection.NotYaml,
    )
    expect(parseDeclaredServices({ text: 'web: {}', file: 'f' }).rejections[0]?.rejection).toBe(
      EServiceRejection.BadShape,
    )
  })
})

describe('allocateServicePort', () => {
  it('prefers a declared port', async () => {
    const port = await allocateServicePort({
      threadId: THREAD,
      name: 'web',
      declared: 3000,
      isFree: async () => false,
    })
    expect(port).toBe(3000)
  })

  it('uses the derived port when free and steps linearly past busy ones', async () => {
    const base = deriveServicePort({ name: 'web' })
    const free = await allocateServicePort({
      threadId: THREAD,
      name: 'web',
      isFree: async () => true,
    })
    expect(free).toBe(base)

    const busy = new Set([base, base + 1])
    const stepped = await allocateServicePort({
      threadId: THREAD,
      name: 'web',
      isFree: async ({ port }) => !busy.has(port),
    })
    expect(stepped).toBe(base + 2)
  })
})
