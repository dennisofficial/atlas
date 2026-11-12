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
  settings: {
    set: { mutate: record('settingsSet', undefined) },
    list: { query: record('settingsList', { settings: [{ key: 'sandbox.image', value: 'img' }] }) },
    remove: { mutate: record('settingsRemove', undefined) },
  },
  secrets: {
    details: { query: record('secretsDetails', { secrets: [{ name: 'OPENAI_KEY' }] }) },
    reveal: { query: record('secretsReveal', { value: 'sk-sandbox' }) },
    set: { mutate: record('secretsSet', undefined) },
    remove: { mutate: record('secretsRemove', undefined) },
  },
  mcpServers: {
    list: { query: record('mcpServersList', { servers: [{ name: 'docs' }] }) },
    put: { mutate: record('mcpServersPut', undefined) },
    remove: { mutate: record('mcpServersRemove', undefined) },
  },
  skills: {
    list: {
      query: record('skillsList', {
        skills: [
          {
            name: 'review',
            description: 'Code review checklist',
            fileCount: 2,
            sizeBytes: 512,
            updatedAt: 't',
            usage: { usedCount30d: 3, lastUsedAt: 't' },
          },
        ],
      }),
    },
    listFiles: {
      query: record('skillsListFiles', {
        files: [
          {
            path: 'SKILL.md',
            revision: 1,
            contentHash: 'h',
            sizeBytes: 300,
            isText: true,
            updatedAt: 't',
          },
          {
            path: 'icon.png',
            revision: 1,
            contentHash: 'h',
            sizeBytes: 212,
            isText: false,
            updatedAt: 't',
          },
        ],
      }),
    },
    get: {
      query: record('skillsGet', {
        path: 'SKILL.md',
        revision: 1,
        contentHash: 'h',
        sizeBytes: 5,
        isText: true,
        updatedAt: 't',
        content: Buffer.from('hello', 'utf8').toString('base64'),
      }),
    },
    put: { mutate: record('skillsPut', { revision: 1 }) },
    remove: { mutate: record('skillsRemove', { removed: true }) },
    removeSkill: { mutate: record('skillsRemoveSkill', { removed: 2 }) },
  },
} as unknown as ApiClient

const invoke = (args: { access: CloudConfigAccess | null; input: unknown }): Promise<ToolOutcome> =>
  new CloudConfigTool(async () => args.access).invoke({
    input: args.input,
    signal: new AbortController().signal,
    idempotencyKey: 'k',
    projectDirectory: '/tmp',
    threadId: toThreadId('t'),
  })

const sandbox: CloudConfigAccess = { client, projectId: 'p1' }

describe('CloudConfigTool', () => {
  it('refuses without a session', async () => {
    const outcome = await invoke({
      access: null,
      input: { scope: 'project', kind: 'secret', action: 'list' },
    })
    expect(outcome).toEqual({ ok: false, reason: 'Not signed in to Atlas Cloud' })
  })

  it('reaches the personal client procedures from a sandbox', async () => {
    calls.length = 0
    const listed = await invoke({
      access: sandbox,
      input: { scope: 'personal', kind: 'secret', action: 'list' },
    })
    expect(listed.ok && listed.modelText).toContain('OPENAI_KEY')

    const read = await invoke({
      access: sandbox,
      input: { scope: 'personal', kind: 'secret', action: 'read', name: 'OPENAI_KEY' },
    })
    expect(read.ok && read.modelText).toBe('sk-sandbox')

    const set = await invoke({
      access: sandbox,
      input: { scope: 'personal', kind: 'secret', action: 'set', name: 'EXA', value: 'e1' },
    })
    expect(set.ok).toBe(true)
    expect(calls).toEqual([
      'secretsDetails null',
      'secretsReveal {"name":"OPENAI_KEY"}',
      'secretsSet {"name":"EXA","value":"e1"}',
    ])
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
      access: sandbox,
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

  it("lists skills in both scopes and one skill's files", async () => {
    calls.length = 0
    const personal = await invoke({
      access: sandbox,
      input: { scope: 'personal', kind: 'skill', action: 'list' },
    })
    expect(personal.ok && personal.modelText).toBe(
      'skills:\nreview — Code review checklist (2 files, 512 B)',
    )
    const project = await invoke({
      access: sandbox,
      input: { scope: 'project', kind: 'skill', action: 'list' },
    })
    expect(project.ok).toBe(true)
    const files = await invoke({
      access: sandbox,
      input: { scope: 'project', kind: 'skill', action: 'list', path: 'review' },
    })
    expect(files.ok && files.modelText).toBe(
      'files of skill review:\nSKILL.md (300 B)\nicon.png (212 B)',
    )
    expect(calls).toEqual([
      'skillsList {"scope":"personal"}',
      'skillsList {"scope":"project","projectId":"p1"}',
      'skillsListFiles {"scope":"project","projectId":"p1","skill":"review"}',
    ])
  })

  it('reads a text skill file as utf8 and refuses a binary one', async () => {
    const read = await invoke({
      access: sandbox,
      input: { scope: 'personal', kind: 'skill', action: 'read', path: 'review/SKILL.md' },
    })
    expect(read.ok && read.modelText).toBe('hello')

    const binary = await invoke({
      access: {
        ...sandbox,
        client: {
          ...client,
          skills: {
            ...client.skills,
            get: {
              query: record('skillsGetBinary', {
                path: 'icon.png',
                revision: 1,
                contentHash: 'h',
                sizeBytes: 4,
                isText: false,
                updatedAt: 't',
                content: 'AAE=',
              }),
            },
          },
        } as unknown as ApiClient,
      },
      input: { scope: 'personal', kind: 'skill', action: 'read', path: 'review/icon.png' },
    })
    expect(binary.ok === false && binary.reason).toBe(
      'binary skill file; replace it from the web settings page',
    )

    const noFile = await invoke({
      access: sandbox,
      input: { scope: 'personal', kind: 'skill', action: 'read', path: 'review' },
    })
    expect(noFile.ok === false && noFile.reason).toContain('path is <skill>/<file>')
  })

  it('sets a skill file with base64 content and its sha256', async () => {
    calls.length = 0
    const set = await invoke({
      access: sandbox,
      input: {
        scope: 'project',
        kind: 'skill',
        action: 'set',
        path: 'review/SKILL.md',
        contents: 'hello',
      },
    })
    expect(set.ok).toBe(true)
    const expectedHash = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    expect(calls).toEqual([
      'skillsListFiles {"scope":"project","projectId":"p1","skill":"review"}',
      `skillsPut {"scope":"project","projectId":"p1","skill":"review","path":"SKILL.md","content":"aGVsbG8=","contentHash":"${expectedHash}","baseRevision":1}`,
    ])
  })

  it('creates a file the skill does not hold yet at baseRevision 0', async () => {
    calls.length = 0
    const set = await invoke({
      access: sandbox,
      input: {
        scope: 'personal',
        kind: 'skill',
        action: 'set',
        path: 'review/new.md',
        contents: 'x',
      },
    })
    expect(set.ok).toBe(true)
    expect(calls[1]).toContain('"path":"new.md"')
    expect(calls[1]).toEndWith('"baseRevision":0}')
  })

  it('removes a whole skill with a one-segment path and a file with two', async () => {
    calls.length = 0
    const skill = await invoke({
      access: sandbox,
      input: { scope: 'personal', kind: 'skill', action: 'remove', path: 'review' },
    })
    expect(skill.ok && skill.modelText).toBe('Removed skill review (2 files).')
    const file = await invoke({
      access: sandbox,
      input: { scope: 'personal', kind: 'skill', action: 'remove', path: 'review/icon.png' },
    })
    expect(file.ok && file.modelText).toBe('Removed file review/icon.png.')
    expect(calls).toEqual([
      'skillsRemoveSkill {"scope":"personal","skill":"review"}',
      'skillsListFiles {"scope":"personal","skill":"review"}',
      'skillsRemove {"scope":"personal","skill":"review","path":"icon.png","baseRevision":1}',
    ])
  })

  it('surfaces a 409 conflict message from the skills api', async () => {
    const failing = {
      ...client,
      skills: {
        ...client.skills,
        put: {
          mutate: async () => {
            throw new Error('the file changed since baseRevision')
          },
        },
      },
    } as unknown as ApiClient
    const outcome = await invoke({
      access: { ...sandbox, client: failing },
      input: {
        scope: 'personal',
        kind: 'skill',
        action: 'set',
        path: 'review/SKILL.md',
        contents: 'x',
      },
    })
    expect(outcome.ok === false && outcome.reason).toContain('changed since baseRevision')
  })

  it('fails project-scope skills without a projectId', async () => {
    const outcome = await invoke({
      access: { ...sandbox, projectId: null },
      input: { scope: 'project', kind: 'skill', action: 'list' },
    })
    expect(outcome.ok === false && outcome.reason).toContain('pass projectId')
  })
})
