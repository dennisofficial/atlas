import { readFile } from 'node:fs/promises'

import { z } from 'zod'

export class FixtureAnswersError extends Error {
  readonly path: string

  constructor({ path, reason }: { path: string; reason: string }) {
    super(`fixture answers file ${path}: ${reason}`)
    this.name = 'FixtureAnswersError'
    this.path = path
  }
}

const decisionAnswerShape = z.object({
  noul: z.number().optional(),
  choice: z.string().optional(),
  score: z.number().optional(),
  probabilities: z.record(z.string(), z.number()).optional(),
  confidence: z.number().optional(),
})

export const fixtureAnswersSchema = z.record(z.string(), z.record(z.string(), decisionAnswerShape))

export async function loadFixtureAnswers({ path }: { path: string }): Promise<Record<string, Record<string, unknown>>> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    throw new FixtureAnswersError({ path, reason: 'file could not be read' })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new FixtureAnswersError({ path, reason: 'not valid JSON' })
  }
  const decoded = fixtureAnswersSchema.safeParse(parsed)
  if (decoded.success) return decoded.data
  const problems = decoded.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
  throw new FixtureAnswersError({ path, reason: problems.join('; ') })
}
