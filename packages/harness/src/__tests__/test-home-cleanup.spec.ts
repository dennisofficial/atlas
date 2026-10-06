import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

const PRELOAD = join(import.meta.dir, 'test-home-setup.ts')

const PROBE_SPEC = `
import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'bun:test'

const log = process.env.PROBE_LOG as string
let lastHome = ''

describe('probe', () => {
  afterEach(() => {
    const home = process.env.ATLAS_HOME as string
    lastHome = home
    appendFileSync(log, JSON.stringify({ home, existsInLocalAfterEach: existsSync(home) }) + '\\n')
  })

  afterAll(() => {
    appendFileSync(log, JSON.stringify({ afterAll: true, lastHomeExists: existsSync(lastHome) }) + '\\n')
  })

  for (const index of [1, 2, 3]) {
    it('writes a bulky file into its home ' + index, () => {
      writeFileSync(join(process.env.ATLAS_HOME as string, 'bulk.bin'), new Uint8Array(4096))
      expect(true).toBe(true)
    })
  }
})
`

let scratch: string

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'test-home-cleanup-'))
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

const runProbe = async (env: Record<string, string>): Promise<{ exitCode: number; output: string }> => {
  const tempDir = join(scratch, 'tmp')
  mkdirSync(tempDir, { recursive: true })
  const spec = join(scratch, 'probe.spec.ts')
  writeFileSync(spec, PROBE_SPEC)

  const child = Bun.spawn({
    cmd: [process.execPath, 'test', '--preload', PRELOAD, spec],
    cwd: scratch,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      ...env,
      TMPDIR: tempDir,
      PROBE_LOG: join(scratch, 'probe.log'),
      ATLAS_TESTING: '1',
    },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
  return { exitCode: await child.exited, output: `${out}${err}` }
}

type EachRecord = { home: string; existsInLocalAfterEach: boolean }
type AllRecord = { afterAll: true; lastHomeExists: boolean }

const records = (): readonly (EachRecord | AllRecord)[] =>
  readFileSync(join(scratch, 'probe.log'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as EachRecord | AllRecord)

const logged = (): readonly EachRecord[] => records().filter((record): record is EachRecord => 'home' in record)
const afterAllRecord = (): AllRecord | undefined =>
  records().find((record): record is AllRecord => 'afterAll' in record)

const SUBPROCESS_TIMEOUT_MS = 30_000

describe('test-home-setup preload', () => {
  it('gives each test its own home, keeps it alive through local afterEach hooks, then removes it', async () => {
    const provided = join(scratch, 'provided-home')
    mkdirSync(provided)
    writeFileSync(join(provided, 'sentinel.txt'), 'keep me')

    const { exitCode, output } = await runProbe({ ATLAS_HOME: provided })
    expect(output).toContain('3 pass')
    expect(exitCode).toBe(0)

    const records = logged()
    expect(records).toHaveLength(3)
    expect(new Set(records.map((record) => record.home)).size).toBe(3)
    for (const record of records) {
      expect(record.home).not.toBe(provided)
      expect(record.home.startsWith(join(scratch, 'tmp'))).toBe(true)
      expect(record.existsInLocalAfterEach).toBe(true)
      expect(existsSync(record.home)).toBe(false)
    }

    expect(afterAllRecord()?.lastHomeExists).toBe(false)
    expect(readFileSync(join(provided, 'sentinel.txt'), 'utf8')).toBe('keep me')
    expect(readdirSync(join(scratch, 'tmp'))).toEqual([])
  }, SUBPROCESS_TIMEOUT_MS)

  it('leaves no homes behind and removes nothing else when no ATLAS_HOME was provided', async () => {
    const bystander = join(scratch, 'tmp', 'atlas-spec-home-someone-elses')
    mkdirSync(bystander, { recursive: true })
    writeFileSync(join(bystander, 'keep.txt'), 'other session')

    const { exitCode } = await runProbe({ ATLAS_HOME: '' })
    expect(exitCode).toBe(0)

    for (const record of logged()) expect(existsSync(record.home)).toBe(false)
    expect(readdirSync(join(scratch, 'tmp'))).toEqual(['atlas-spec-home-someone-elses'])
    expect(readFileSync(join(bystander, 'keep.txt'), 'utf8')).toBe('other session')
  }, SUBPROCESS_TIMEOUT_MS)
})
