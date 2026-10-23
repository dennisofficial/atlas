import { appendFileSync } from 'node:fs'
import { join, normalize } from 'node:path'

import { chromium, type Browser } from 'playwright'

import {
  EIndexEntryType,
  selectAffectedStories,
  type AffectedSelection,
  type PreviewStats,
  type StoryIndex,
} from './affected-stories'

enum ERenderMode {
  Plan = 'plan',
  Render = 'render',
}

const STORYBOOK_DIR = join(import.meta.dir, '..')
const STATIC_DIR = join(STORYBOOK_DIR, 'storybook-static')
const REPO_ROOT = join(STORYBOOK_DIR, '..', '..')
const LOCAL_BASE = 'origin/main'
const CONCURRENCY = 4
const STORY_TIMEOUT_MS = 15_000
const READY_CLASSES = ['sb-show-main', 'sb-show-errordisplay']
const ERROR_CLASS = 'sb-show-errordisplay'
const ALL_ZEROS = /^0+$/

interface StoryFailure {
  id: string
  message: string
}

function runGit(args: string[]): string[] {
  const result = Bun.spawnSync(['git', ...args], { cwd: REPO_ROOT })
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString().trim()}`)
  }
  return result.stdout
    .toString()
    .split('\n')
    .filter((line) => line.length > 0)
}

function firstLine(text: string): string {
  return text.split('\n')[0]?.trim() ?? ''
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : value
}

function resolveChangedFiles(): string[] | 'all' {
  if (readEnv('RENDER_CHECK_ALL') === '1') return 'all'
  const base = process.env['RENDER_CHECK_BASE']
  if (base !== undefined) {
    if (base === '' || ALL_ZEROS.test(base)) return 'all'
    return runGit(['diff', '--name-only', base, 'HEAD'])
  }
  if (readEnv('CI') !== undefined) throw new Error('RENDER_CHECK_BASE is required in CI')
  const committed = runGit(['diff', '--name-only', `${LOCAL_BASE}...HEAD`])
  const uncommitted = runGit(['diff', '--name-only', 'HEAD'])
  return [...new Set([...committed, ...uncommitted])]
}

async function readJson<T>(name: string): Promise<T> {
  const file = Bun.file(join(STATIC_DIR, name))
  if (!(await file.exists())) throw new Error(`${name} missing — run \`bun run build\` first`)
  return (await file.json()) as T
}

function selectStories(params: { stats: PreviewStats; index: StoryIndex }): AffectedSelection {
  const changed = resolveChangedFiles()
  const allIds = Object.values(params.index.entries)
    .filter((entry) => entry.type === EIndexEntryType.Story)
    .map((entry) => entry.id)
  if (changed === 'all') {
    return { renderAll: true, storyIds: allIds, reason: 'full render requested' }
  }
  const selection = selectAffectedStories({ ...params, changedFiles: changed })
  return selection.renderAll ? { ...selection, storyIds: allIds } : selection
}

function describeSelection(params: { selection: AffectedSelection; total: number }): string {
  const { selection, total } = params
  const scope = selection.renderAll ? 'all' : String(selection.storyIds.length)
  return `render-check: ${scope} of ${total} stories (${selection.reason})`
}

function serveStatic(): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    port: 0,
    async fetch(request) {
      const path = normalize(decodeURIComponent(new URL(request.url).pathname))
      const file = Bun.file(join(STATIC_DIR, path))
      if (path.startsWith('..') || !(await file.exists())) {
        return new Response('not found', { status: 404 })
      }
      return new Response(file)
    },
  })
}

async function renderStory(params: {
  browser: Browser
  origin: string
  id: string
}): Promise<StoryFailure | undefined> {
  const page = await params.browser.newPage()
  const problems: string[] = []
  page.on('pageerror', (error) => problems.push(`pageerror: ${firstLine(error.message)}`))
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console.error: ${firstLine(message.text())}`)
  })
  try {
    await page.goto(`${params.origin}/iframe.html?id=${params.id}&viewMode=story`)
    await page.waitForFunction(
      (classes) => classes.some((name) => document.body.classList.contains(name)),
      READY_CLASSES,
      { timeout: STORY_TIMEOUT_MS },
    )
    const errorDisplay = await page.evaluate(
      (name) =>
        document.body.classList.contains(name)
          ? (document.querySelector('#error-message')?.textContent ?? 'error display shown')
          : undefined,
      ERROR_CLASS,
    )
    if (errorDisplay !== undefined) problems.unshift(`error display: ${firstLine(errorDisplay)}`)
  } catch (error) {
    problems.unshift(error instanceof Error ? (error.message.split('\n')[0] ?? 'failed') : 'failed')
  } finally {
    await page.close()
  }
  return problems.length === 0 ? undefined : { id: params.id, message: problems.join(' | ') }
}

async function renderAll(params: { ids: string[] }): Promise<StoryFailure[]> {
  const server = serveStatic()
  const browser = await chromium.launch()
  const failures: StoryFailure[] = []
  const queue = [...params.ids]
  const origin = `http://localhost:${server.port}`
  const handleWorker = async (): Promise<void> => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      const failure = await renderStory({ browser, origin, id })
      if (failure) failures.push(failure)
    }
  }
  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, handleWorker))
  } finally {
    await browser.close()
    await server.stop(true)
  }
  return failures
}

async function main(): Promise<number> {
  const mode = process.argv[2] === ERenderMode.Plan ? ERenderMode.Plan : ERenderMode.Render
  const stats = await readJson<PreviewStats>('preview-stats.json')
  const index = await readJson<StoryIndex>('index.json')
  const selection = selectStories({ stats, index })
  const total = Object.values(index.entries).filter(
    (entry) => entry.type === EIndexEntryType.Story,
  ).length
  console.log(describeSelection({ selection, total }))

  if (mode === ERenderMode.Plan) {
    const output = process.env['GITHUB_OUTPUT']
    if (output) appendFileSync(output, `count=${selection.storyIds.length}\n`)
    for (const id of selection.storyIds) console.log(`  ${id}`)
    return 0
  }

  const started = performance.now()
  const failures = await renderAll({ ids: selection.storyIds })
  for (const failure of failures.sort((a, b) => a.id.localeCompare(b.id))) {
    console.log(`FAIL ${failure.id}: ${failure.message}`)
  }
  const seconds = ((performance.now() - started) / 1000).toFixed(1)
  console.log(
    `rendered ${selection.storyIds.length} of ${total} stories in ${seconds}s, ${failures.length} failed`,
  )
  return failures.length === 0 ? 0 : 1
}

process.exit(await main())
