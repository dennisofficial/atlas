import { describe, expect, it } from 'bun:test'

import {
  EEffortLevel,
  EMemoryScope,
  EMemoryType,
  EMcpTransportKind,
  ESecretKind as EWireSecretKind,
} from '@dltech/atlas-wire/web'

import { EAgentRole, EEffort, EPreset, PRESETS } from '../../../fixtures/settings-agent'
import { ESecretKind } from '../../../fixtures/settings-library'
import { EMcpTransport } from '../../../fixtures/settings-mcp'
import { EDeviceKind } from '../../../fixtures/settings-security'
import { apiKeyFor, subscriptionFor } from '../accounts-api'
import { deviceNameOf, toDevice } from '../auth-session-api'
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
import { buildGroups, memoryQuery } from '../memory-api'
import { activePresetOf, modelsChanges, modelsConfigFrom } from '../models-settings'
import { relativeTime } from '../relative-time'
import { splitSandboxes, ESandboxState } from '../sandboxes-api'
import { toLibrarySecret } from '../secrets-api'
import { EProviderId } from '../../../fixtures/settings-agent'

const NOW = Date.parse('2026-10-20T12:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()

describe('relativeTime', () => {
  it('buckets elapsed time', () => {
    expect(relativeTime({ from: ago(10_000), now: NOW })).toBe('just now')
    expect(relativeTime({ from: ago(5 * 60_000), now: NOW })).toBe('5m ago')
    expect(relativeTime({ from: ago(3 * 3_600_000), now: NOW })).toBe('3h ago')
    expect(relativeTime({ from: ago(3 * 86_400_000), now: NOW })).toBe('3d ago')
    expect(relativeTime({ from: ago(21 * 86_400_000), now: NOW })).toBe('3w ago')
  })
})

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
  const summary = (args: { project: string | null; name: string }) => ({
    scope: args.project === null ? EMemoryScope.Global : EMemoryScope.Project,
    project: args.project,
    name: args.name,
    description: 'd',
    type: EMemoryType.User,
    revision: 1,
    updatedAt: 'x',
  })

  it('groups global first, then one group per project found in the rows', () => {
    const groups = buildGroups([
      summary({ project: 'a/b', name: 'p1' }),
      summary({ project: null, name: 'g' }),
      summary({ project: 'c/d', name: 'q' }),
      summary({ project: 'a/b', name: 'p2' }),
    ])
    expect(groups.map((group) => group.id)).toEqual(['global', 'a/b', 'c/d'])
    expect(groups[0]?.memories.map((entry) => entry.name)).toEqual(['g'])
    expect(groups[1]?.memories.map((entry) => entry.name)).toEqual(['p1', 'p2'])
    expect(groups[2]).toMatchObject({ scope: EMemoryScope.Project, project: 'c/d' })
  })

  it('always offers an empty global group', () => {
    expect(buildGroups([]).map((group) => group.id)).toEqual(['global'])
  })

  it('builds the entry query', () => {
    expect(memoryQuery({ scope: EMemoryScope.Global, project: null, name: 'n' })).toBe(
      'scope=global&name=n',
    )
    expect(memoryQuery({ scope: EMemoryScope.Project, project: 'a/b', name: 'n' })).toBe(
      'scope=project&name=n&project=a%2Fb',
    )
  })
})

describe('secrets mapping', () => {
  it('maps a detail onto a library row', () => {
    const row = toLibrarySecret({
      detail: {
        name: 'A',
        kind: EWireSecretKind.EnvVar,
        value: 'v',
        createdAt: ago(0),
        updatedAt: ago(2 * 3_600_000),
      },
      addedBy: { name: 'Me', initials: 'M' },
      now: NOW,
    })
    expect(row).toMatchObject({ key: 'A', kind: ESecretKind.EnvVar, value: 'v', updated: '2h ago' })
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

describe('accounts mapping', () => {
  const account = (args: { id: string; provider: string; kind: string }) => ({
    ...args,
    label: 'l',
    status: 'active',
    createdAt: '2026-10-02T00:00:00Z',
  })
  it('splits subscriptions and api keys per provider', () => {
    const accounts = [
      account({ id: '1', provider: 'anthropic', kind: 'oauth' }),
      account({ id: '2', provider: 'anthropic', kind: 'api-key' }),
    ]
    expect(subscriptionFor({ accounts, provider: EProviderId.Anthropic })?.id).toBe('1')
    expect(apiKeyFor({ accounts, provider: EProviderId.Anthropic })).toEqual({
      id: '2',
      label: 'l',
      added: 'Added Oct 2',
    })
    expect(apiKeyFor({ accounts, provider: EProviderId.OpenAI })).toBeNull()
  })
})

describe('models settings', () => {
  it('reads defaults as the Balanced preset', () => {
    const config = modelsConfigFrom(new Map())
    expect(activePresetOf(config)).toBe(EPreset.Balanced)
  })

  it('maps stored values onto the effort slider and auto model', () => {
    const config = modelsConfigFrom(
      new Map([
        ['model.effort', 'xhigh'],
        ['model.id', 'openai/gpt-5'],
      ]),
    )
    expect(config[EAgentRole.Main]).toEqual({ model: 'openai/gpt-5', effort: EEffort.High })
  })

  it('writes only changed keys, with auto as empty and a preset marker', () => {
    const saved = PRESETS[EPreset.Balanced]
    const changes = modelsChanges({ saved, draft: PRESETS[EPreset.Thorough] })
    expect(changes['model.id']).toBe('anthropic/claude-opus-5')
    expect(changes['model.effort']).toBe(EEffortLevel.Max)
    expect(changes['web.models.preset']).toBe('thorough')
    expect(modelsChanges({ saved, draft: saved })).toEqual({})
    const custom = modelsChanges({
      saved,
      draft: { ...saved, [EAgentRole.Main]: { model: 'x/y', effort: EEffort.High } },
    })
    expect(custom['web.models.preset']).toBe('custom')
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

  it('reads and diffs the notification matrix', () => {
    const saved = notificationsFrom(new Map([['web.notifications.event.finished.email', true]]))
    expect(saved.matrix.finished?.email).toBe(true)
    expect(saved.channels).toEqual({ push: true, email: true })
    const draft = { ...saved, quietFrom: '23:00' }
    expect(notificationChanges({ saved, draft })).toEqual({
      'web.notifications.quietFrom': '23:00',
    })
  })
})

describe('sessions and sandboxes', () => {
  it('names devices from the user agent', () => {
    expect(
      deviceNameOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Chrome/120 Safari/537'),
    ).toBe('Chrome on macOS')
    expect(deviceNameOf(null)).toBe('Unknown device')
  })

  it('marks the current session', () => {
    const session = {
      id: 'i',
      token: 't',
      userAgent: 'curl/8',
      ipAddress: '1.2.3.4',
      createdAt: ago(60_000 * 5),
      expiresAt: 'x',
    }
    const device = toDevice({ session, currentToken: 't', now: NOW })
    expect(device).toMatchObject({
      id: 't',
      current: true,
      kind: EDeviceKind.Cli,
      meta: '1.2.3.4 · Last active 5m ago',
    })
    expect(toDevice({ session, currentToken: 'other', now: NOW }).current).toBe(false)
  })

  it('splits sandboxes by state with unknown columns blank', () => {
    const entry = (state: ESandboxState) => ({
      threadId: state,
      name: 'n',
      state,
      lastActivityAt: ago(3_600_000),
    })
    const { running, paused } = splitSandboxes({
      entries: [entry(ESandboxState.Running), entry(ESandboxState.Parked)],
      now: NOW,
    })
    expect(running[0]).toMatchObject({ runningFor: '1h ago', cost: '—' })
    expect(paused[0]).toMatchObject({ pausedAgo: '1h ago' })
  })
})
