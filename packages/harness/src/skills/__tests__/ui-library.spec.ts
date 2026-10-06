import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
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
  baseline_sha256: z.string(),
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
  image_sha256: z.string(),
})
const tokensSchema = z.record(z.string(), z.string().regex(/^#[\dA-Fa-f]{6}$/))
const videoCoverageSchema = z.array(z.object({
  slug: z.string(),
  video_duration_seconds: z.number(),
  audio_duration_seconds: z.number(),
  segments: z.number(),
  excluded_segments: z.number(),
  frames: z.number(),
  transcript: z.string(),
  transcript_sha256: z.string(),
  references: z.array(z.string()),
}))
const transcriptSchema = z.object({
  duration_seconds: z.number(),
  transcription: z.object({ disclaimer: z.string() }),
  coverage: z.object({
    entire_audio_processed: z.literal(true),
    audio_input_trimmed: z.literal(false),
    transcription_text_capped: z.literal(false),
    tail_status: z.string(),
  }),
  segments: z.array(z.object({ id: z.number(), start: z.number(), end: z.number(), text: z.string() })),
  excluded_segments: z.array(z.object({ id: z.number(), exclusion_reason: z.string() })),
  frames: z.array(z.object({ path: z.string(), time_seconds: z.number() })),
})

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
      const coveragePath = join(ASSETS, 'coverage', `${source.id}.json`)
      expect((await readFile(coveragePath, 'utf8')).split('\n').length).toBeLessThanOrEqual(300)
      const coverage = z.array(pageSchema).parse(await jsonAt(coveragePath))
      const reconstructed: { page: number; text: string }[] = []
      expect(coverage.map((row) => row.page)).toEqual(Array.from({ length: source.pages }, (_, index) => index + 1))
      for (const reference of new Set(coverage.map((row) => row.reference))) {
        const text = references.get(reference) ?? ''
        const actualPages = [...text.matchAll(/^### Source page (\d+)$/gm)].map((match) => Number(match[1]))
        expect(actualPages).toEqual(coverage.filter((row) => row.reference === reference).map((row) => row.page))
      }
      let sourceCharacters = 0
      for (const row of coverage) {
        const markdown = references.get(row.reference)
        if (markdown === undefined) throw new Error(`missing reference ${row.reference}`)
        const text = pageText({ markdown, page: row.page })
        reconstructed.push({ page: row.page, text })
        const heading = markdown.indexOf(`### Source page ${row.page}\n`)
        const section = markdown.slice(heading, markdown.indexOf('```text\n', heading))
        expect(linksIn(section)).toEqual([`../assets/${row.image}`])
        expect(sha256(text)).toBe(row.text_sha256)
        expect([...text].length).toBe(row.text_characters)
        const image = await readFile(join(ASSETS, row.image))
        expect([...image.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff])
        expect(image.length).toBeGreaterThan(100)
        expect(sha256(image)).toBe(row.image_sha256)
        sourceCharacters += [...text].length
      }
      expect(sha256(JSON.stringify(reconstructed, null, 2))).toBe(source.baseline_sha256)
      expect(sourceCharacters).toBe(source.baseline_characters)
      characters += sourceCharacters
      pages += coverage.length
    }
    expect(characters).toBe(193322)
    expect(characters).toBe(metadata.source_text_characters)
    expect(pages).toBe(525)
    expect(pages).toBe(metadata.visual_pages)
    const outline = z.array(z.tuple([z.number(), z.string(), z.number()])).parse(await jsonAt(join(ASSETS, 'book-outline.json')))
    expect(outline).toHaveLength(153)
    const allText = [...references.values()].join('\n')
    for (const [, title, page] of outline) expect(allText).toContain(`${title} (source page ${page})`)
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

  it('preserves every accepted video segment with timestamps, caveats, and visual frames', async () => {
    const videos = videoCoverageSchema.parse(await jsonAt(join(ASSETS, 'video-coverage.json')))
    expect(videos.map((video) => video.slug)).toEqual(['content-design', 'complex-form', 'dashboard'])
    expect(videos.map((video) => video.video_duration_seconds)).toEqual([728.45, 672.85, 1039.98])
    expect(videos.reduce((sum, video) => sum + video.segments, 0)).toBe(550)
    expect(videos.reduce((sum, video) => sum + video.excluded_segments, 0)).toBe(10)
    expect(videos.reduce((sum, video) => sum + video.frames, 0)).toBe(40)
    for (const video of videos) {
      const raw = await readFile(join(ASSETS, video.transcript), 'utf8')
      expect(sha256(raw)).toBe(video.transcript_sha256)
      const data = transcriptSchema.parse(JSON.parse(raw))
      expect(data.duration_seconds).toBe(video.audio_duration_seconds)
      expect(Math.abs(video.video_duration_seconds - data.duration_seconds)).toBeLessThan(0.01)
      expect(data.transcription.disclaimer).toContain('Not a manually verified verbatim transcript')
      expect(data.coverage.tail_status).toContain('not human-audited')
      expect(data.segments).toHaveLength(video.segments)
      expect(data.excluded_segments).toHaveLength(video.excluded_segments)
      expect(new Set([...data.segments, ...data.excluded_segments].map((segment) => segment.id)).size).toBe(video.segments + video.excluded_segments)
      const narrated: string[] = []
      for (const reference of video.references) {
        const text = await readFile(join(REFERENCES, reference), 'utf8')
        for (const match of text.matchAll(/^- \*\*\[[^\]]+\]\*\* (.+)$/gm)) {
          if (match[1] !== undefined) narrated.push(match[1])
        }
      }
      expect(narrated).toEqual(data.segments.map((segment) => segment.text.trim()))
      let priorEnd = 0
      for (const segment of data.segments) {
        expect(segment.start).toBeGreaterThanOrEqual(priorEnd - 0.01)
        expect(segment.end).toBeGreaterThanOrEqual(segment.start)
        expect(segment.end).toBeLessThanOrEqual(data.duration_seconds)
        priorEnd = segment.end
      }
      for (const frame of data.frames) {
        expect(frame.time_seconds).toBeGreaterThanOrEqual(0)
        expect(frame.time_seconds).toBeLessThanOrEqual(video.video_duration_seconds)
        expect(await Bun.file(join(ASSETS, frame.path)).exists()).toBe(true)
      }
    }
  })

  it('ships no raw PDFs, videos, audio, or transcription-model weights', async () => {
    const glob = new Bun.Glob('**/*')
    let bytes = 0
    for await (const path of glob.scan({ cwd: ROOT, dot: true })) {
      expect(path).toMatch(/\.(md|json|jpg)$/i)
      bytes += (await stat(join(ROOT, path))).size
    }
    expect(bytes).toBeLessThan(64 * 1024 * 1024)
  })
})
