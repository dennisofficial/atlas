import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FixtureAnswersError, fixtureAnswersSchema, loadFixtureAnswers } from '../fixture-answers'

let directory = ''

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'fixture-answers-'))
})

afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

const writeFixture = async ({ name, text }: { name: string; text: string }): Promise<string> => {
  const path = join(directory, name)
  await writeFile(path, text, 'utf8')
  return path
}

describe('loadFixtureAnswers', () => {
  it('loads answers keyed by row key then prefixed question id', async () => {
    const answers = {
      'case-1::trial-1::variant-a': {
        'single-responsibility:currentConcern': { noul: 0.25, confidence: 0.9 },
        'single-responsibility:verdict': { choice: 'violates', probabilities: { violates: 0.8, clean: 0.2 }, score: 3 },
      },
    }
    const path = await writeFixture({ name: 'valid.json', text: JSON.stringify(answers) })
    expect(await loadFixtureAnswers({ path })).toEqual(answers)
  })

  it('loads an empty object', async () => {
    const path = await writeFixture({ name: 'empty.json', text: '{}' })
    expect(await loadFixtureAnswers({ path })).toEqual({})
  })

  it('throws FixtureAnswersError naming the file on malformed JSON', async () => {
    const path = await writeFixture({ name: 'malformed.json', text: '{ not json' })
    const failure = await loadFixtureAnswers({ path }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(FixtureAnswersError)
    expect((failure as FixtureAnswersError).message).toContain(path)
    expect((failure as FixtureAnswersError).message).toContain('not valid JSON')
  })

  it('throws FixtureAnswersError naming the file on a wrong shape', async () => {
    const path = await writeFixture({ name: 'wrong.json', text: JSON.stringify({ row: { q: { noul: 'high' } } }) })
    const failure = await loadFixtureAnswers({ path }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(FixtureAnswersError)
    expect((failure as FixtureAnswersError).message).toContain(path)
    expect((failure as FixtureAnswersError).message).toContain('row.q.noul')
  })

  it('throws FixtureAnswersError when the file is missing', async () => {
    const path = join(directory, 'absent.json')
    await expect(loadFixtureAnswers({ path })).rejects.toBeInstanceOf(FixtureAnswersError)
  })
})

describe('fixtureAnswersSchema', () => {
  it('rejects a top-level array', () => {
    expect(fixtureAnswersSchema.safeParse([]).success).toBe(false)
  })
})
