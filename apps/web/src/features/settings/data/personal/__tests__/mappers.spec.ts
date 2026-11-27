import { describe, expect, it } from 'bun:test'

import { EMemoryScope, EMemoryType, EMcpTransportKind } from '@dltech/atlas-wire/web'

import { EMcpTransport } from '../../../fixtures/settings-mcp'
import { base64ToUtf8, encodeFileContent, utf8ToBase64 } from '../file-encoding'
import { docOf } from '../instructions-api'
import {
  appearanceChanges,
  appearanceFrom,
  notificationChanges,
  notificationsFrom,
} from '../interface-settings'
import { splitCommandLine } from '../../command-line'
import { toMcpServer, transportOf } from '../mcp-api'
import { buildGroups, memoryKeyInput } from '../memory-api'
import { modelsChanges, modelsDraftFrom } from '../models-settings'

describe('file encoding', () => {
  it('round-trips utf8 and hashes the raw bytes', async () => {
    expect(base64ToUtf8(utf8ToBase64('héllo ✓'))).toBe('héllo ✓')
    const encoded = await encodeFileContent('hello')
    expect(encoded.content).toBe('aGVsbG8=')
    expect(encoded.contentHash).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    )
  })

  it('treats missing and tombstoned instructions as empty', () => {
    expect(docOf({ files: [] })).toEqual({ text: '', revision: 0 })
    expect(
      docOf({
        files: [{ path: '.atlas/ATLAS.md', revision: 4, tombstonedAt: 'x', content: null }],
      }),
    ).toEqual({ text: '', revision: 4 })
    expect(
      docOf({
        files: [{ path: '.atlas/ATLAS.md', revision: 2, tombstonedAt: null, content: 'aGVsbG8=' }],
      }),
    ).toEqual({ text: 'hello', revision: 2 })
  })
})

describe('memory mapping', () => {
  const summary = (args: {
    scope?: EMemoryScope
    project: string | null
    groupId?: string | null
    name: string
  }) => ({
    scope: args.scope ?? (args.project === null ? EMemoryScope.Global : EMemoryScope.Project),
    project: args.project,
    groupId: args.groupId ?? null,
    name: args.name,
    description: 'd',
    type: EMemoryType.User,
    revision: 1,
    updatedAt: 'x',
  })

  it('groups global first, then one group per project group and project in the rows', () => {
    const groups = buildGroups({
      memories: [
        summary({ project: 'a/b', name: 'p1' }),
        summary({ project: null, name: 'g' }),
        summary({ scope: EMemoryScope.Group, project: null, groupId: 'pgr_comp', name: 'c1' }),
        summary({ project: 'c/d', name: 'q' }),
        summary({ project: 'a/b', name: 'p2' }),
      ],
      groupNames: new Map([['pgr_comp', 'Comp AI']]),
    })
    expect(groups.map((group) => group.id)).toEqual(['global', 'group:pgr_comp', 'a/b', 'c/d'])
    expect(groups[0]?.memories.map((entry) => entry.name)).toEqual(['g'])
    expect(groups[1]).toMatchObject({
      scope: EMemoryScope.Group,
      groupId: 'pgr_comp',
      name: 'Comp AI',
    })
    expect(groups[2]?.memories.map((entry) => entry.name)).toEqual(['p1', 'p2'])
    expect(groups[3]).toMatchObject({ scope: EMemoryScope.Project, project: 'c/d' })
  })

  it('always offers an empty global group', () => {
    expect(buildGroups({ memories: [], groupNames: new Map() }).map((group) => group.id)).toEqual([
      'global',
    ])
  })

  it('builds the entry input', () => {
    expect(
      memoryKeyInput({ scope: EMemoryScope.Global, project: null, groupId: null, name: 'n' }),
    ).toEqual({ scope: 'global', name: 'n' })
    expect(
      memoryKeyInput({ scope: EMemoryScope.Project, project: 'a/b', groupId: null, name: 'n' }),
    ).toEqual({ scope: 'project', name: 'n', project: 'a/b' })
    expect(
      memoryKeyInput({ scope: EMemoryScope.Group, project: null, groupId: 'pgr_comp', name: 'n' }),
    ).toEqual({ scope: 'group', name: 'n', groupId: 'pgr_comp' })
  })
})

describe('mcp mapping', () => {
  it('splits command lines with quotes', () => {
    expect(splitCommandLine(`npx -y "a b" 'c d' e`)).toEqual({
      command: 'npx',
      args: ['-y', 'a b', 'c d', 'e'],
    })
    expect(splitCommandLine('   ')).toEqual({ command: '', args: [] })
  })

  it('maps the add draft to a transport', () => {
    expect(transportOf({ transport: EMcpTransport.Stdio, target: 'npx -y pkg' })).toEqual({
      kind: EMcpTransportKind.Stdio,
      command: 'npx',
      args: ['-y', 'pkg'],
    })
    expect(transportOf({ transport: EMcpTransport.Http, target: ' https://x.dev/mcp ' })).toEqual({
      kind: EMcpTransportKind.Http,
      url: 'https://x.dev/mcp',
    })
    expect(() => transportOf({ transport: EMcpTransport.Stdio, target: ' ' })).toThrow()
  })

  it('maps wire servers to rows', () => {
    expect(
      toMcpServer({
        name: 's',
        transport: { kind: EMcpTransportKind.Stdio, command: 'npx', args: ['a'] },
        disabled: true,
        updatedAt: 'x',
      }),
    ).toEqual({ id: 's', transport: EMcpTransport.Stdio, target: 'npx a', enabled: false })
  })
})

describe('models settings', () => {
  it('reads defaults as followers on the harness keys', () => {
    const draft = modelsDraftFrom(new Map())
    expect(draft.main).toEqual({ model: '', effort: '', fast: false })
    expect(draft['agent-type:builder']).toEqual({ model: '', effort: '', fast: false })
  })

  it('maps stored values onto their role entries', () => {
    const draft = modelsDraftFrom(
      new Map([
        ['model.effort', 'xhigh'],
        ['model.id', 'openai/gpt-5'],
        ['model.quickModel', 'openai/gpt-5-mini'],
        ['agents.type.teammate', 'anthropic/claude-opus-5'],
      ]),
    )
    expect(draft.main).toEqual({ model: 'openai/gpt-5', effort: 'xhigh', fast: false })
    expect(draft.quick?.model).toBe('openai/gpt-5-mini')
    expect(draft['agent-type:teammate']?.model).toBe('anthropic/claude-opus-5')
  })

  it('writes only changed keys', () => {
    const saved = modelsDraftFrom(new Map())
    expect(modelsChanges({ saved, draft: saved })).toEqual({})
    const changes = modelsChanges({
      saved,
      draft: { ...saved, main: { model: 'openai/gpt-5', effort: 'high', fast: true } },
    })
    expect(changes).toEqual({
      'model.id': 'openai/gpt-5',
      'model.effort': 'high',
      'model.fast': true,
    })
  })
})

describe('interface settings', () => {
  it('round-trips appearance defaults and only diffs changes', () => {
    const saved = appearanceFrom(new Map())
    expect(saved).toMatchObject({ theme: 'dark', density: 'comfortable', codeFontSize: 13 })
    expect(appearanceChanges({ saved, draft: { ...saved, reduceMotion: true } })).toEqual({
      'web.appearance.reduceMotion': true,
    })
  })

  it('reads and diffs the three notification moments', () => {
    const saved = notificationsFrom(
      new Map([
        ['web.notifications.event.finished.push', false],
        ['web.notifications.timezone', 'Europe/Berlin'],
      ]),
    )
    expect(saved.events).toEqual({ finished: false, errored: true, approval: true })
    expect(saved.timezone).toBe('Europe/Berlin')
    const draft = { ...saved, quietFrom: '23:00' }
    expect(notificationChanges({ saved, draft })).toEqual({
      'web.notifications.quietFrom': '23:00',
    })
  })

  it('writes a moment to its push key and keeps the zone', () => {
    const saved = notificationsFrom(new Map())
    const draft = { ...saved, events: { ...saved.events, approval: false }, timezone: 'UTC' }
    expect(notificationChanges({ saved, draft })).toEqual({
      'web.notifications.event.approval.push': false,
      'web.notifications.timezone': 'UTC',
    })
  })
})
