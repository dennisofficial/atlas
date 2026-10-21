import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { corpusCaseFrom, type CorpusCase } from '../corpus'

export const CORPUS_DIRECTORY = join(import.meta.dirname, 'corpus')

export function readCorpus({ directory }: { directory: string }): readonly CorpusCase[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) =>
      corpusCaseFrom({ name, json: JSON.parse(readFileSync(join(directory, name), 'utf8')) }),
    )
}
