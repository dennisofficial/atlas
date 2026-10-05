import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ContextBrowser, MAX_CONTEXT_ENTRIES, MAX_CONTEXT_FILE_BYTES } from '../context-browser'
import { MAX_MENTION_BYTES } from '../file-browser'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function fixture(files: Record<string, string> = {}): Promise<ContextBrowser> {
  const root = await mkdtemp(join(tmpdir(), 'atlas-context-browser-'))
  roots.push(root)
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), content)
  }
  return new ContextBrowser({ root })
}

describe('ContextBrowser', () => {
  it('lists one level, sorted, directories flagged', async () => {
    const browser = await fixture({ 'b.md': 'b', 'a.md': 'a', 'sub/inner.md': 'i' })

    expect(await browser.list()).toEqual([
      { name: 'a.md', isDirectory: false },
      { name: 'b.md', isDirectory: false },
      { name: 'sub', isDirectory: true },
    ])
    expect(await browser.list('sub')).toEqual([{ name: 'inner.md', isDirectory: false }])
  })

  it('lists a missing directory as empty', async () => {
    const browser = await fixture()

    expect(await browser.list('nope')).toEqual([])
  })

  it('caps the listing at the entry ceiling', async () => {
    const names: Record<string, string> = {}
    for (let index = 0; index < MAX_CONTEXT_ENTRIES + 10; index += 1) {
      names[`f${String(index).padStart(4, '0')}.md`] = 'x'
    }
    const browser = await fixture(names)

    expect(await browser.list()).toHaveLength(MAX_CONTEXT_ENTRIES)
  })

  it('refuses to list outside the folder', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'atlas-context-outside-'))
    roots.push(outside)
    await writeFile(join(outside, 'secret.md'), 'hidden')
    const browser = await fixture()

    expect(await browser.list('../atlas-context-outside-tmp')).toEqual([])
    expect(await browser.list('/etc')).toEqual([])
  })

  it('refuses to follow a symlink out of the folder', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'atlas-context-outside-'))
    roots.push(outside)
    await writeFile(join(outside, 'secret.md'), 'hidden')
    const browser = await fixture()
    const link = join(roots[roots.length - 1] ?? '', 'link')
    await symlink(outside, link, 'dir')

    expect(await browser.list('link')).toEqual([])
    expect((await browser.load('link/secret.md')).type).toBe('refused')
  })

  it('loads a text file', async () => {
    const browser = await fixture({ 'plan.md': '# plan\n' })

    expect(await browser.load('plan.md')).toEqual({ type: 'text', content: '# plan\n', truncated: false })
  })

  it('refuses missing, directory, and binary paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atlas-context-browser-'))
    roots.push(root)
    await writeFile(join(root, 'bin.dat'), Buffer.from([1, 0, 2]))
    const browser = new ContextBrowser({ root })

    expect((await browser.load('nope.md')).type).toBe('refused')
    expect((await browser.load('.')).type).toBe('refused')
    expect((await browser.load('bin.dat')).type).toBe('refused')
  })

  it('refuses a path that escapes the folder', async () => {
    const browser = await fixture({ 'plan.md': 'p' })

    expect((await browser.load('../plan.md')).type).toBe('refused')
    expect((await browser.load('/etc/hosts')).type).toBe('refused')
  })

  it('reads the entire file beyond the mention ceiling', async () => {
    const browser = await fixture({ 'big.txt': 'x'.repeat(MAX_MENTION_BYTES + 100) })

    const loaded = await browser.load('big.txt')
    if (loaded.type !== 'text') throw new Error('expected text')
    expect(loaded.truncated).toBe(false)
    expect(loaded.content.length).toBe(MAX_MENTION_BYTES + 100)
  })

  it('refuses files beyond the viewer limit without returning a partial file', async () => {
    const browser = await fixture({ 'too-big.txt': 'x'.repeat(MAX_CONTEXT_FILE_BYTES + 1) })
    expect((await browser.load('too-big.txt')).type).toBe('refused')
  })

  it('returns a PNG by its magic bytes, base64, never by its name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atlas-context-browser-'))
    roots.push(root)
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
    await writeFile(join(root, 'shot.txt'), png)
    await writeFile(join(root, 'fake.png'), 'not an image')
    const browser = new ContextBrowser({ root })

    expect(await browser.load('shot.txt')).toEqual({
      type: 'image',
      data: png.toString('base64'),
      mediaType: 'image/png',
    })
    expect((await browser.load('fake.png')).type).toBe('text')
  })

  it('sniffs jpeg, gif, and webp', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atlas-context-browser-'))
    roots.push(root)
    await writeFile(join(root, 'a'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))
    await writeFile(join(root, 'b'), Buffer.from('GIF89a0000', 'ascii'))
    await writeFile(join(root, 'c'), Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP', 'ascii')]))
    const browser = new ContextBrowser({ root })

    expect(await browser.load('a')).toMatchObject({ mediaType: 'image/jpeg' })
    expect(await browser.load('b')).toMatchObject({ mediaType: 'image/gif' })
    expect(await browser.load('c')).toMatchObject({ mediaType: 'image/webp' })
  })
})
