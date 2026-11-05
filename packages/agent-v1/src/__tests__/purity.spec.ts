import { describe, expect, it } from 'bun:test'

const sourceRoot = new URL('..', import.meta.url).pathname

const readSources = async (): Promise<{ path: string; text: string }[]> => {
  const paths = [...new Bun.Glob('**/*.ts').scanSync(sourceRoot)].filter(
    (path) => !path.includes('__tests__'),
  )
  return Promise.all(
    paths.map(async (path) => ({ path, text: await Bun.file(`${sourceRoot}${path}`).text() })),
  )
}

const offendingLines = async (pattern: RegExp): Promise<string[]> => {
  const sources = await readSources()
  return sources.flatMap(({ path, text }) =>
    text
      .split('\n')
      .filter((line) => pattern.test(line))
      .map((line) => `${path}: ${line.trim()}`),
  )
}

describe('@dltech/atlas-agent-v1 is pure', () => {
  it('has source files to check', async () => {
    expect((await readSources()).length).toBeGreaterThan(10)
  })

  it('imports no AI SDK, node, bun, harness or client module', async () => {
    expect(
      await offendingLines(
        /from\s+['"](ai|@ai-sdk\/[^'"]*|node:[^'"]*|bun|bun:[^'"]*|@dltech\/atlas-harness[^'"]*|@dltech\/atlas-client[^'"]*)['"]/,
      ),
    ).toEqual([])
  })

  it('reaches for no Bun API', async () => {
    expect(await offendingLines(/\bBun\./)).toEqual([])
  })
})
