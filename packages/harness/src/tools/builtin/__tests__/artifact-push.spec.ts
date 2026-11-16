import { describe, expect, it } from 'bun:test'

import { sha256Hex } from '@dltech/atlas-artifacts'

import { ArtifactUnavailable } from '../../../artifacts/artifact-port'

import { LINKED, indexHtml, invoke, modelTextOf, reasonOf, rigOf } from './artifact-push-rig'

describe('artifact_push', () => {
  it('sends exactly the selected entries with their hashes', async () => {
    const rig = rigOf()
    modelTextOf(await invoke({}, rig.tool))

    const [begin] = rig.port.beginCalls
    expect(begin?.entries.map((entry) => entry.path)).toEqual([
      '.env.example',
      'app.js',
      'index.html',
    ])
    const html = begin?.entries.find((entry) => entry.path === 'index.html')
    expect(html).toMatchObject({
      tree: 'src',
      size: new TextEncoder().encode(indexHtml).byteLength,
      sha256: sha256Hex(new TextEncoder().encode(indexHtml)),
      type: 'text/html; charset=utf-8',
    })
    expect(rig.port.commitCalls).toHaveLength(1)
  })

  it('never publishes a .env file but does publish .env.example', async () => {
    const rig = rigOf()
    modelTextOf(await invoke({}, rig.tool))

    const paths = rig.port.beginCalls[0]?.entries.map((entry) => entry.path) ?? []
    expect(paths).not.toContain('.env')
    expect(paths).not.toContain('.env.local')
    expect(paths).toContain('.env.example')
  })

  it('never publishes a hard-excluded path', async () => {
    const rig = rigOf()
    modelTextOf(await invoke({}, rig.tool))

    const paths = rig.port.beginCalls[0]?.entries.map((entry) => entry.path) ?? []
    expect(paths).not.toContain('node_modules/dep/index.js')
    expect(paths).not.toContain('.git/config')
    expect(paths).not.toContain('untracked-but-present.txt')
  })

  it('PUTs only the presigned uploads, once each', async () => {
    const rig = rigOf()
    modelTextOf(await invoke({}, rig.tool))

    expect(rig.calls.map((call) => call.url).sort()).toEqual([
      'https://upload.test/dist/.env.example',
      'https://upload.test/dist/app.js',
      'https://upload.test/dist/index.html',
      'https://upload.test/src/.env.example',
      'https://upload.test/src/app.js',
      'https://upload.test/src/index.html',
    ])
    expect(rig.calls.every((call) => call.method === 'PUT')).toBe(true)
  })

  it('reads artifact.json and applies its exclude list', async () => {
    const rig = rigOf({ spec: { serve: { spa: true }, publish: { exclude: ['app.js'] } } })
    modelTextOf(await invoke({}, rig.tool))

    const paths = rig.port.beginCalls[0]?.entries.map((entry) => entry.path) ?? []
    expect(paths).not.toContain('app.js')
  })

  it('asks git for tracked and unignored files in the chosen directory', async () => {
    const rig = rigOf({ prefix: '/ws/site' })
    modelTextOf(await invoke({ dir: 'site' }, rig.tool))

    expect(rig.processes.commands).toContainEqual([
      'git',
      '-C',
      '/ws/site',
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
    ])
  })

  it('initialises git in a directory outside a worktree and says so', async () => {
    const rig = rigOf()
    rig.processes.insideWorktree = false

    const text = modelTextOf(await invoke({}, rig.tool))

    expect(rig.processes.commands).toContainEqual([
      'git',
      '-C',
      '/ws',
      'rev-parse',
      '--is-inside-work-tree',
    ])
    expect(rig.processes.commands).toContainEqual(['git', '-C', '/ws', 'init', '-q'])
    expect(text).toContain('Initialised git in /ws so the push could list its files.')
    expect(rig.port.commitCalls).toHaveLength(1)
  })

  it('leaves a directory already inside a worktree alone', async () => {
    const rig = rigOf()

    const text = modelTextOf(await invoke({}, rig.tool))

    expect(rig.processes.commands.some((cmd) => cmd.includes('init'))).toBe(false)
    expect(text).not.toContain('Initialised git')
  })

  it('reports a directory git cannot list as prose', async () => {
    const rig = rigOf()
    rig.processes.gitExitCode = 128
    rig.processes.stderr = 'fatal: unable to read directory'

    const outcome = await invoke({}, rig.tool)

    expect(outcome.ok).toBe(false)
    expect(reasonOf(outcome)).toContain('could not list the files in /ws')
  })

  it('turns a port error into prose rather than throwing', async () => {
    const rig = rigOf()
    rig.port.failure = new ArtifactUnavailable('sign in to Atlas Cloud to publish artifacts')

    const outcome = await invoke({}, rig.tool)

    expect(outcome.ok).toBe(false)
    expect(outcome.ok ? '' : outcome.reason).toContain('sign in to Atlas Cloud')
    expect(rig.calls).toHaveLength(0)
  })

  it('states the URL and version it published', async () => {
    const rig = rigOf()
    const text = modelTextOf(await invoke({}, rig.tool))

    expect(text).toContain('https://demo.artifacts.test')
    expect(text).toContain('version 3')
  })
})

describe('artifact_push keeps one URL per directory', () => {
  it('links an unlinked directory to the artifact its first publish created', async () => {
    const rig = rigOf()
    const text = modelTextOf(await invoke({}, rig.tool))

    expect(rig.port.beginCalls[0]?.subdomain).toBeUndefined()
    expect(rig.files.text('/ws/artifact.json')).toBe('{\n  "subdomain": "demo"\n}\n')
    expect(text).toContain('/ws/artifact.json')
  })

  it('keeps the settings of the artifact.json it links', async () => {
    const rig = rigOf({ spec: { serve: { spa: true } } })
    modelTextOf(await invoke({}, rig.tool))

    expect(JSON.parse(rig.files.text('/ws/artifact.json') ?? '')).toEqual({
      subdomain: 'demo',
      serve: { spa: true },
    })
  })

  it('republishes a linked directory to the artifact it links to', async () => {
    const rig = rigOf({ spec: { subdomain: LINKED } })
    modelTextOf(await invoke({}, rig.tool))

    expect(rig.port.beginCalls[0]?.subdomain).toBe(LINKED)
    expect(rig.files.text('/ws/artifact.json')).toBe(JSON.stringify({ subdomain: LINKED }))
  })

  it('never sends the spec, because the server reads artifact.json from the pushed source', async () => {
    const rig = rigOf({ spec: { subdomain: LINKED, serve: { spa: true } } })
    modelTextOf(await invoke({}, rig.tool))

    expect(rig.port.commitCalls[0]).toEqual({ artifactId: 'art_1', version: 3 })
  })

  it('reads the link from an artifact.json that git does not list', async () => {
    const rig = rigOf({ spec: { subdomain: LINKED }, paths: ['index.html'] })
    modelTextOf(await invoke({}, rig.tool))

    expect(rig.port.beginCalls[0]?.subdomain).toBe(LINKED)
  })

  it('links an unlinked directory to the existing artifact it is told to publish to', async () => {
    const rig = rigOf()
    modelTextOf(await invoke({ subdomain: LINKED }, rig.tool))

    expect(rig.port.beginCalls[0]?.subdomain).toBe(LINKED)
    expect(JSON.parse(rig.files.text('/ws/artifact.json') ?? '')).toEqual({ subdomain: LINKED })
  })

  it('refuses a subdomain other than the one the directory links to', async () => {
    const rig = rigOf({ spec: { subdomain: LINKED } })

    const outcome = await invoke({ subdomain: 'zzzzzzzzzzzz' }, rig.tool)

    expect(outcome.ok).toBe(false)
    expect(reasonOf(outcome)).toContain(LINKED)
    expect(rig.port.beginCalls).toHaveLength(0)
  })

  it('refuses a linked directory whose artifact is gone rather than creating a new URL', async () => {
    const rig = rigOf({ spec: { subdomain: LINKED } })
    rig.port.missing.add(LINKED)

    const outcome = await invoke({}, rig.tool)

    expect(outcome.ok).toBe(false)
    expect(reasonOf(outcome)).toContain(LINKED)
    expect(rig.port.beginCalls.map((call) => call.subdomain)).toEqual([LINKED])
    expect(rig.port.commitCalls).toHaveLength(0)
    expect(rig.files.text('/ws/artifact.json')).toBe(JSON.stringify({ subdomain: LINKED }))
  })

  it('refuses an artifact.json whose link is not a subdomain', async () => {
    const rig = rigOf({ spec: { subdomain: 'Not A Subdomain' } })

    const outcome = await invoke({}, rig.tool)

    expect(outcome.ok).toBe(false)
    expect(reasonOf(outcome)).toContain('subdomain')
    expect(rig.port.beginCalls).toHaveLength(0)
  })
})
