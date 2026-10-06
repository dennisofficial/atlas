import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

const ROOT = resolve(import.meta.dir, '../../../skills/ui-design')
const REFERENCES = join(ROOT, 'references')
const ASSETS = join(ROOT, 'assets')
const SOURCE_COUNTS = { book: 218, palette: 152, gallery: 86, font: 69 }

const sourceSchema = z.object({
  id: z.string(),
  pages: z.number(),
  baseline_characters: z.number(),
})
const paletteSchema = z.object({
  name: z.string(),
  strict_name: z.string(),
  source_sha256: z.string(),
  strict_sha256: z.string(),
  entries: z.number(),
})
const provenanceSchema = z.object({
  sources: z.array(sourceSchema),
  palette_archive: z.object({ entries: z.array(paletteSchema) }),
  source_text_characters: z.number(),
  visual_pages: z.number(),
})
const pageSchema = z.object({
  page: z.number(),
  reference: z.string(),
  image: z.string(),
  text_characters: z.number(),
  text_sha256: z.string(),
})
const tokensSchema = z.record(z.string(), z.string().regex(/^#[\dA-Fa-f]{6}$/))

const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex')
const jsonAt = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'))
const linksIn = (text: string): readonly string[] =>
  [...text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].flatMap((match) => match[1] === undefined ? [] : [match[1]])

function pageText(args: { markdown: string; page: number }): string {
  const marker = `### Source page ${args.page}\n`
  const offset = args.markdown.indexOf(marker)
  if (offset < 0) throw new Error(`missing ${marker.trim()}`)
  const opening = args.markdown.indexOf('```text\n', offset)
  if (opening < 0) throw new Error(`missing text block for page ${args.page}`)
  const start = opening + '```text\n'.length
  const end = args.markdown.indexOf('\n```\n', start)
  if (end < 0) throw new Error(`missing text block end for page ${args.page}`)
  return args.markdown.slice(start, end)
}

const originalTokens = (text: string): Record<string, string> =>
  tokensSchema.parse(JSON.parse(text.replace(/\/\/[^\n]*/g, '').replace(/,\s*}/g, '}')))

async function textCache(): Promise<ReadonlyMap<string, string>> {
  const pairs = await Promise.all((await readdir(REFERENCES)).map(async (file) =>
    [file, await readFile(join(REFERENCES, file), 'utf8')] as const,
  ))
  return new Map(pairs)
}

describe('the shipped UI design library', () => {
  it('routes straight to every focused reference without loading source bodies', async () => {
    const entry = await readFile(join(ROOT, 'SKILL.md'), 'utf8')
    const files = (await readdir(REFERENCES)).sort()
    const linked = linksIn(entry).filter((path) => path.startsWith('references/')).map((path) => path.slice('references/'.length))

    expect(entry).toContain('name: ui-design')
    expect(entry).toContain('web, mobile, or terminal')
    expect(entry).toContain('do not preload the whole library')
    expect(entry.split('\n').length).toBeLessThanOrEqual(300)
    expect(new Set(linked).size).toBe(linked.length)
    expect(linked.sort()).toEqual(files)
    expect(entry).not.toContain('```text')
  })

  it('keeps every reference short and every local resource link reachable', async () => {
    const references = await textCache()
    for (const [file, text] of references) {
      expect(text.split('\n').length).toBeLessThanOrEqual(300)
      for (const link of linksIn(text)) {
        if (/^https?:/.test(link)) continue
        const target = resolve(dirname(join(REFERENCES, file)), link)
        expect(target.startsWith(`${ROOT}/`)).toBe(true)
        expect(await Bun.file(target).exists()).toBe(true)
      }
    }
  })

  it('preserves all 525 PDF pages and all 193322 extracted source characters', async () => {
    const metadata = provenanceSchema.parse(await jsonAt(join(ASSETS, 'source-provenance.json')))
    const references = await textCache()
    let characters = 0
    let pages = 0
    expect(metadata.sources.map((source) => [source.id, source.pages])).toEqual(Object.entries(SOURCE_COUNTS))

    for (const source of metadata.sources) {
      const coverage = z.array(pageSchema).parse(await jsonAt(join(ASSETS, 'coverage', `${source.id}.json`)))
      expect(coverage.map((row) => row.page)).toEqual(Array.from({ length: source.pages }, (_, index) => index + 1))
      let sourceCharacters = 0
      for (const row of coverage) {
        const markdown = references.get(row.reference)
        if (markdown === undefined) throw new Error(`missing reference ${row.reference}`)
        const text = pageText({ markdown, page: row.page })
        expect(sha256(text)).toBe(row.text_sha256)
        expect([...text].length).toBe(row.text_characters)
        const image = await readFile(join(ASSETS, row.image))
        expect([...image.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff])
        expect(image.length).toBeGreaterThan(100)
        sourceCharacters += [...text].length
      }
      expect(sourceCharacters).toBe(source.baseline_characters)
      characters += sourceCharacters
      pages += coverage.length
    }
    expect(characters).toBe(193322)
    expect(characters).toBe(metadata.source_text_characters)
    expect(pages).toBe(525)
    expect(pages).toBe(metadata.visual_pages)
    expect(z.array(z.unknown()).parse(await jsonAt(join(ASSETS, 'book-outline.json')))).toHaveLength(153)
  })

  it('preserves palette-local values, source roles, and valid strict JSON companions', async () => {
    const metadata = provenanceSchema.parse(await jsonAt(join(ASSETS, 'source-provenance.json')))
    expect(metadata.palette_archive.entries).toHaveLength(25)
    for (const palette of metadata.palette_archive.entries) {
      const original = await readFile(join(ASSETS, palette.name), 'utf8')
      const strict = await readFile(join(ASSETS, palette.strict_name), 'utf8')
      expect(sha256(original)).toBe(palette.source_sha256)
      expect(sha256(strict)).toBe(palette.strict_sha256)
      const sourceTokens = originalTokens(original)
      expect(Object.keys(sourceTokens)).toHaveLength(palette.entries)
      expect(tokensSchema.parse(JSON.parse(strict))).toEqual(sourceTokens)
    }
    const cyan = originalTokens(await readFile(join(ASSETS, 'palette-01.json'), 'utf8'))
    const purple = originalTokens(await readFile(join(ASSETS, 'palette-03.json'), 'utf8'))
    const swatches = originalTokens(await readFile(join(ASSETS, 'swatches.json'), 'utf8'))
    expect(cyan['grey-500']).toBe('#627D98')
    expect(purple['purple-500']).toBe('#5D55FA')
    expect(cyan['grey-500']).not.toBe(swatches['grey-500'])
    expect(purple['purple-500']).not.toBe(swatches['purple-500'])
  })

  it('ships no raw PDFs, videos, audio, or transcription-model weights', async () => {
    const glob = new Bun.Glob('**/*')
    for await (const path of glob.scan({ cwd: ROOT })) {
      expect(path).not.toMatch(/\.(pdf|mp4|wav|mp3|safetensors)$/i)
    }
  })
})
