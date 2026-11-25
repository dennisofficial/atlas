import { describe, expect, it } from 'bun:test'

import manifest from '../../package.json'

const ALLOWED = [
  '@dltech/atlas-api-router',
  '@dltech/atlas-client',
  '@dltech/atlas-commands',
  '@dltech/atlas-core',
  '@dltech/atlas-models',
  '@dltech/atlas-notifications',
  '@dltech/atlas-observability',
  '@dltech/atlas-protocol',
  '@dltech/atlas-syntax',
] as const

const PLUGIN_PREFIX = '@dltech/atlas-plugin-'

const ALLOWED_PLUGIN_SLOTS = ['/client', '/core']

const PLUGIN_SDK = '@dltech/atlas-plugin-sdk'

const FORBIDDEN_IMPORT =
  /from ['"](@dltech\/atlas-wire|tsyringe|reflect-metadata|\.\.\/composition|\.\.\/\.\.\/composition)/

const atlasDependencies = Object.keys(manifest.dependencies).filter((name) =>
  name.startsWith('@dltech/'),
)

describe('@dltech/atlas boundaries', () => {
  it('depends on nothing the TUI is not allowed to reach', () => {
    const offenders = atlasDependencies.filter(
      (name) => !(ALLOWED as readonly string[]).includes(name) && !name.startsWith(PLUGIN_PREFIX),
    )

    expect(offenders).toEqual([])
  })

  it('names no wire, tsyringe or reflect-metadata anywhere in the manifest', () => {
    const text = JSON.stringify(manifest)

    for (const forbidden of ['@dltech/atlas-wire', 'tsyringe', 'reflect-metadata']) {
      expect(text).not.toContain(forbidden)
    }
  })

  it('imports nothing forbidden in src', async () => {
    const glob = new Bun.Glob('src/**/*.{ts,tsx}')
    const offenders: string[] = []

    for await (const file of glob.scan({ cwd: process.cwd() })) {
      const text = await Bun.file(file).text()
      if (FORBIDDEN_IMPORT.test(text)) offenders.push(file)
    }

    expect(offenders).toEqual([])
  })

  it('reaches a plugin only through the slots a surface may hold', async () => {
    const glob = new Bun.Glob('src/**/*.{ts,tsx}')
    const offenders: string[] = []

    for await (const file of glob.scan({ cwd: process.cwd() })) {
      const text = await Bun.file(file).text()
      for (const match of text.matchAll(
        /from ['"](@dltech\/atlas-plugin-[a-z-]+)(\/[a-z-]+)?['"]/g,
      )) {
        const slot = match[2] ?? ''
        if (match[1] === PLUGIN_SDK || ALLOWED_PLUGIN_SLOTS.includes(slot)) continue
        offenders.push(`${file} ${match[1]}${slot}`)
      }
    }

    expect(offenders).toEqual([])
  })
})
