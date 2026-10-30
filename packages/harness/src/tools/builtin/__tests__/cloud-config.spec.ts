import { toThreadId, type ToolOutcome } from '@dltech/atlas-core'
import type { ApiClient } from '@dltech/atlas-api-router'
import { describe, expect, it } from 'bun:test'

import type { CloudConfigAccess } from '../../../cloud/cloud-config-access'
import { CloudConfigTool } from '../cloud-config'

const calls: string[] = []
const record = (name: string, result: unknown) => async (input?: unknown) => {
  calls.push(`${name} ${JSON.stringify(input ?? null)}`)
  return result
}

const client = {
  projectResources: {
    listSecrets: { query: record('listSecrets', { secrets: [{ name: 'API' }] }) },
    revealSecret: { query: record('revealSecret', { value: 'hunter2' }) },
    listFileMounts: {
      query: record('listFileMounts', { mounts: [{ path: '~/a.pem', mode: 0o600 }] }),
    },
    setFileMount: { mutate: record('setFileMount', undefined) },
    listMcpServers: {
      query: record('listMcpServers', {
        servers: [
          {
            name: 'docs',
            transport: {
              kind: 'http',
              url: 'https://x.test',
              headers: { Authorization: 'Bearer s3cret' },
            },
            updatedAt: 't',
          },
          {
            name: 'local',
            transport: { kind: 'stdio', command: 'npx', args: ['srv'], env: { TOKEN: 'hunter3' } },
            updatedAt: 't',
          },
        ],
      }),
    },
    patchSettings: { mutate: record('patchSettings', undefined) },
  },
  settings: { set: { mutate: record('settingsSet', undefined) } },
} as unknown as ApiClient

const invoke = (args: { access: CloudConfigAccess | null; input: unknown }): Promise<ToolOutcome> =>
  new CloudConfigTool(async () => args.access).invoke({
    input: args.input,
    signal: new AbortController().signal,
    idempotencyKey: 'k',
    projectDirectory: '/tmp',
    threadId: toThreadId('t'),
  })

const sandbox: CloudConfigAccess = { client, inSandbox: true, projectId: 'p1' }

describe('CloudConfigTool', () => {
  it('refuses without a session', async () => {
    const outcome = await invoke({
      access: null,
      input: { scope: 'project', kind: 'secret', action: 'list' },
    })
    expect(outcome).toEqual({ ok: false, reason: 'Not signed in to Atlas Cloud' })
  })

  it('refuses personal scope from a sandbox', async () => {
    const outcome = await invoke({
      access: sandbox,
      input: { scope: 'personal', kind: 'setting', action: 'set', name: 'a', value: 'b' },
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.ok === false && outcome.reason).toContain('signed-in terminal or the web')
  })

  it('lists secret names without values and defaults the project', async () => {
    calls.length = 0
    const outcome = await invoke({
      access: sandbox,
      input: { scope: 'project', kind: 'secret', action: 'list' },
    })
    expect(outcome.ok && outcome.modelText).toContain('API')
    expect(outcome.ok && outcome.modelText).not.toContain('hunter2')
    expect(calls).toEqual(['listSecrets {"projectId":"p1"}'])
  })

  it('reads a secret value and maps file set to setFileMount', async () => {
    calls.length = 0
    const read = await invoke({
      access: sandbox,
      input: { scope: 'project', kind: 'secret', action: 'read', name: 'API' },
    })
    expect(read.ok && read.modelText).toBe('hunter2')
    await invoke({
      access: sandbox,
      input: {
        scope: 'project',
        kind: 'file',
        action: 'set',
        path: '~/a.pem',
        contents: 'x',
        mode: '0644',
      },
    })
    expect(calls[1]).toBe(
      'setFileMount {"projectId":"p1","path":"~/a.pem","contents":"x","mode":420}',
    )
  })

  it('lists file mounts without contents and encodes setting values', async () => {
    calls.length = 0
    const listed = await invoke({
      access: sandbox,
      input: { scope: 'project', kind: 'file', action: 'list' },
    })
    expect(listed.ok && listed.modelText).toBe('file mounts:\n~/a.pem (mode 600)')
    await invoke({
      access: { ...sandbox, inSandbox: false },
      input: {
        scope: 'personal',
        kind: 'setting',
        action: 'set',
        name: 'sandbox.vcpus',
        value: '4',
      },
    })
    expect(calls[1]).toBe('settingsSet {"key":"sandbox.vcpus","value":"atlas-setting:v1:4"}')
  })

  it('accepts an octal mode without the leading zero and rejects other text', async () => {
    calls.length = 0
    const base = { scope: 'project', kind: 'file', action: 'set', path: 'a.env', contents: 'x' }
    await invoke({ access: sandbox, input: { ...base, mode: '600' } })
    expect(calls[0]).toContain('"mode":384')
    for (const mode of ['0888', '6000', 'rw-', 420]) {
      const outcome = await invoke({ access: sandbox, input: { ...base, mode } })
      expect(outcome.ok).toBe(false)
    }
  })

  it('lists mcp servers with header and env keys only, and reads the full spec', async () => {
    const listed = await invoke({
      access: sandbox,
      input: { scope: 'project', kind: 'mcp', action: 'list' },
    })
    const text = listed.ok ? listed.modelText : ''
    expect(text).toContain('docs http https://x.test headers: Authorization')
    expect(text).toContain('local stdio npx env: TOKEN')
    expect(text).not.toContain('s3cret')
    expect(text).not.toContain('hunter3')
    const read = await invoke({
      access: sandbox,
      input: { scope: 'project', kind: 'mcp', action: 'read', name: 'docs' },
    })
    expect(read.ok && read.modelText).toContain('Bearer s3cret')
  })

  it('coerces setting values by the registry type', async () => {
    calls.length = 0
    const set = (name: string, value: string) =>
      invoke({
        access: sandbox,
        input: { scope: 'project', kind: 'setting', action: 'set', name, value },
      })
    await set('sandbox.vcpus', '4')
    await set('sandbox.image', '4')
    expect(calls[0]).toContain('"sandbox.vcpus":"atlas-setting:v1:4"')
    expect(calls[1]).toContain('"sandbox.image":"atlas-setting:v1:\\"4\\""')
    const unknown = await set('NODE_EXTRA_CA_CERTS', '/x')
    expect(unknown.ok === false && unknown.reason).toContain('unknown setting key')
    const bad = await set('sandbox.vcpus', 'many')
    expect(bad.ok).toBe(false)
  })

  it('asks for projectId when the session has none', async () => {
    const outcome = await invoke({
      access: { ...sandbox, projectId: null },
      input: { scope: 'project', kind: 'secret', action: 'list' },
    })
    expect(outcome.ok).toBe(false)
  })
})
