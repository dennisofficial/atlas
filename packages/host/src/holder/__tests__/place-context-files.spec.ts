import { describe, expect, it } from 'bun:test'

import {
  contextFilesPlacerOf,
  placeContextFiles,
  type ContextFileWrites,
} from '../place-context-files'

const DIRECTORY = '/atlas/home/sessions/s-1/context'

const writesOf = (
  args: { links?: Readonly<Record<string, string>>; failOn?: string } = {},
): { writes: ContextFileWrites; calls: string[]; written: Record<string, string> } => {
  const calls: string[] = []
  const written: Record<string, string> = {}
  const writes: ContextFileWrites = {
    readLink: async ({ path }) => args.links?.[path] ?? null,
    mkdir: async ({ path }) => {
      calls.push(`mkdir ${path}`)
    },
    writeFile: async ({ path, content }) => {
      if (path === args.failOn) throw new Error('the pod disk is full')
      calls.push(`write ${path}`)
      written[path] = content
    },
  }
  return { writes, calls, written }
}

describe('placeContextFiles', () => {
  it('writes each file at its relative place under the context folder', async () => {
    const fake = writesOf()
    const placed = await placeContextFiles({
      files: [
        { path: 'plan.md', text: 'the plan' },
        { path: 'sections/03-auth.md', text: 'the auth section' },
      ],
      directory: DIRECTORY,
      writes: fake.writes,
    })
    expect(placed).toEqual({ written: 2, refused: [] })
    expect(fake.calls).toEqual([
      `mkdir ${DIRECTORY}`,
      `write ${DIRECTORY}/plan.md`,
      `mkdir ${DIRECTORY}/sections`,
      `write ${DIRECTORY}/sections/03-auth.md`,
    ])
    expect(fake.written).toEqual({
      [`${DIRECTORY}/plan.md`]: 'the plan',
      [`${DIRECTORY}/sections/03-auth.md`]: 'the auth section',
    })
  })

  it('refuses a file behind a linked folder, and writes nothing outside', async () => {
    const fake = writesOf({ links: { [`${DIRECTORY}/sections`]: '/etc' } })
    const placed = await placeContextFiles({
      files: [{ path: 'sections/passwd.md', text: 'outside' }],
      directory: DIRECTORY,
      writes: fake.writes,
    })
    expect(placed.written).toBe(0)
    expect(placed.refused).toHaveLength(1)
    expect(placed.refused[0]).toContain('sections/passwd.md')
    expect(placed.refused[0]).toContain(`${DIRECTORY}/sections`)
    expect(fake.calls).toEqual([])
    expect(fake.written).toEqual({})
  })

  it('refuses a file that is itself a link, so it never follows it', async () => {
    const fake = writesOf({ links: { [`${DIRECTORY}/plan.md`]: '/etc/passwd' } })
    const placed = await placeContextFiles({
      files: [{ path: 'plan.md', text: 'outside' }],
      directory: DIRECTORY,
      writes: fake.writes,
    })
    expect(placed.written).toBe(0)
    expect(placed.refused[0]).toContain('plan.md')
    expect(fake.calls).toEqual([])
  })

  it('refuses a path that is not a plain relative name', async () => {
    const fake = writesOf()
    const placed = await placeContextFiles({
      files: [{ path: '../outside.md', text: 'outside' }],
      directory: DIRECTORY,
      writes: fake.writes,
    })
    expect(placed.written).toBe(0)
    expect(placed.refused[0]).toContain('../outside.md')
    expect(fake.calls).toEqual([])
  })

  it('lets a write error out, so the prepare can record it as failed', async () => {
    const fake = writesOf({ failOn: `${DIRECTORY}/plan.md` })
    await expect(
      placeContextFiles({
        files: [{ path: 'plan.md', text: 'the plan' }],
        directory: DIRECTORY,
        writes: fake.writes,
      }),
    ).rejects.toThrow('the pod disk is full')
  })
})

describe('contextFilesPlacerOf', () => {
  it('places through the daemon port, reading the links it meets', async () => {
    const links: string[] = []
    const written: string[] = []
    const place = contextFilesPlacerOf({
      directory: DIRECTORY,
      port: {
        readLink: async ({ path }) => {
          links.push(path)
          return null
        },
        mkdir: async () => null,
        writeFile: async ({ path }) => {
          written.push(path)
          return null
        },
      },
    })
    const placed = await place({ files: [{ path: 'plan.md', text: 'the plan' }] })
    expect(placed).toEqual({ written: 1, refused: [] })
    expect(links).toEqual([`${DIRECTORY}/plan.md`])
    expect(written).toEqual([`${DIRECTORY}/plan.md`])
  })
})
