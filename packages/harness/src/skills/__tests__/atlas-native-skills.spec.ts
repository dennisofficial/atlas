import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { EPromptAgent, toThreadId, type PromptContext } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { SkillListingFragment } from '../../prompt/fragments/skills'
import { SkillTool } from '../../tools/builtin/skill'
import { EmbeddedSkillSource } from '../embedded-source'
import { LiveSkillRegistry } from '../live-registry'
import { BUILT_IN_SKILLS } from '../manifest.generated'
import { digestOfBytes } from '../embedded-bundle'
import { ESkillOrigin, isSkillEntryFilename } from '../skill'

const ATLAS_SKILLS = ['atlas-config', 'atlas-cloud']

const registryOfBuiltIns = async (): Promise<LiveSkillRegistry> => {
  const registry = new LiveSkillRegistry({ sources: () => [new EmbeddedSkillSource()] })
  await registry.reload()
  return registry
}

const contextFor = (agent: EPromptAgent): PromptContext => ({
  agent,
  provider: { id: 'anthropic', modelId: 'claude-sonnet-4-6' },
  model: { contextWindow: 200_000 },
  projectDirectory: '/unrelated/project',
})

describe('native Atlas help skills', () => {
  it.each(ATLAS_SKILLS)(
    'ships %s as an invocable built-in without installed files',
    async (name) => {
      const registry = await registryOfBuiltIns()
      const skill = registry.byName(name)

      expect(skill).toBeDefined()
      expect(skill?.origin).toBe(ESkillOrigin.BuiltIn)
      expect(skill?.frontmatter.name).toBe(name)
      expect(skill?.frontmatter.description.length).toBeGreaterThan(0)
      expect(skill?.body.trim().length).toBeGreaterThan(0)
      expect(skill?.userInvocable).toBe(true)
      expect(skill?.modelInvocable).toBe(true)
      expect(skill?.directory).toBeUndefined()
      expect(skill?.entryPath).toBeUndefined()
      expect(skill?.warnings).toEqual([])
    },
  )

  it.each(Object.values(EPromptAgent))(
    'lists help without its body headings for %s agents',
    async (agent) => {
      const registry = await registryOfBuiltIns()
      const listing = new SkillListingFragment(registry).text(contextFor(agent))

      for (const name of ATLAS_SKILLS) {
        const skill = registry.byName(name)
        expect(skill).toBeDefined()
        if (skill === undefined) throw new Error(`Missing built-in skill: ${name}`)
        expect(listing).toContain(name)
        expect(listing).toContain(skill.frontmatter.description)
        for (const heading of skill.body.split('\n').filter((line) => line.startsWith('#'))) {
          expect(listing).not.toContain(heading)
        }
      }
    },
  )

  it.each(ATLAS_SKILLS)('loads the complete %s guide from an unrelated project', async (name) => {
    const registry = await registryOfBuiltIns()
    const skill = registry.byName(name)
    expect(skill).toBeDefined()
    if (skill === undefined) throw new Error(`Missing built-in skill: ${name}`)

    for (const argumentText of ['', 'one two three four five six seven eight nine']) {
      const outcome = await new SkillTool(registry).invoke({
        input: { name, arguments: argumentText },
        signal: AbortSignal.timeout(5_000),
        idempotencyKey: `load-${name}`,
        projectDirectory: '/unrelated/project',
        threadId: toThreadId('native-skills-test'),
      })

      expect(outcome.ok).toBe(true)
      if (!outcome.ok) throw new Error(outcome.reason)
      expect(outcome.modelText).toBe(skill.body)
      expect(outcome.output).toEqual({
        name,
        directory: undefined,
        path: undefined,
        text: skill.body,
        argumentText,
      })
    }
  })
})

describe('the shipped skill manifest', () => {
  it('embeds exactly the current authored Markdown content', async () => {
    const directory = fileURLToPath(new URL('../../../skills/', import.meta.url))
    const roots = await readdir(directory, { withFileTypes: true })
    const selected = await Promise.all(roots.map(async (root): Promise<readonly string[]> => {
      if (root.isFile() && root.name.toLowerCase().endsWith('.md')) return [root.name]
      if (!root.isDirectory()) return []
      const entry = (await readdir(join(directory, root.name))).find(isSkillEntryFilename)
      return entry === undefined ? [] : [`${root.name}/${entry}`]
    }))
    const authored = await Promise.all(selected.flat().sort().map(async (path) =>
      ({ path, text: await readFile(join(directory, path), 'utf8') }),
    ))

    expect(BUILT_IN_SKILLS.map(({ path, text }) => ({ path, text }))).toEqual(authored)
  })

  it('keeps every bundled resource path and digest synchronized with authored files', async () => {
    const directory = fileURLToPath(new URL('../../../skills/', import.meta.url))
    for (const entry of BUILT_IN_SKILLS) {
      if (!entry.path.includes('/')) continue
      const root = join(directory, dirname(entry.path))
      const entryName = entry.path.split('/').at(-1)
      const paths = (await Array.fromAsync(new Bun.Glob('**/*').scan({ cwd: root, dot: true })))
        .filter((path) => path !== entryName && !path.endsWith('.DS_Store')).sort()
      const resources = entry.bundle?.files ?? []
      expect(resources.map((file) => file.path).sort()).toEqual(paths)
      for (const file of resources) {
        expect(digestOfBytes(await readFile(join(root, file.path)))).toBe(file.digest)
      }
    }
  })
})
