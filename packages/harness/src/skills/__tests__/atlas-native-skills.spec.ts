import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { EPromptAgent, toThreadId, type PromptContext } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { SkillListingFragment } from '../../prompt/fragments/skills'
import { SkillTool } from '../../tools/builtin/skill'
import { EmbeddedSkillSource } from '../embedded-source'
import { LiveSkillRegistry } from '../live-registry'
import { BUILT_IN_SKILLS } from '../manifest.generated'
import { ESkillOrigin } from '../skill'

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
    const paths = await Array.fromAsync(new Bun.Glob('**/*.md').scan({ cwd: directory }))
    const authored = await Promise.all(
      paths
        .sort()
        .map(async (path) => ({ path, text: await readFile(`${directory}/${path}`, 'utf8') })),
    )

    expect(BUILT_IN_SKILLS).toEqual(authored)
  })
})
