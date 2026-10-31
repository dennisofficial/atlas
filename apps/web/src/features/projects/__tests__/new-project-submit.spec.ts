import { describe, expect, it } from 'bun:test'

import { createBodyOf, emptyDraft } from '../new-project-draft'
import { submitProject, type SubmissionProgress } from '../new-project-submit'

const body = createBodyOf({ draft: emptyDraft(), name: 'scratch' })
const pairs = [
  { name: 'API_KEY', value: 'sensitive' },
  { name: 'TOKEN', value: 'other' },
]

describe('submitProject', () => {
  it('creates the project before sequentially saving each named value', async () => {
    const calls: string[] = []
    const progress: SubmissionProgress = { projectId: null, remaining: pairs }
    await submitProject({
      body,
      progress,
      createProject: async (payload) => {
        expect(payload).toEqual(body)
        calls.push('create')
        return { id: 'project-1' }
      },
      putSecret: async (args) => {
        expect(args).toEqual({ projectId: 'project-1', ...pairs[calls.length - 1] })
        calls.push(args.name)
        await Promise.resolve()
        expect(calls.at(-1)).toBe(args.name)
      },
    })
    expect(calls).toEqual(['create', 'API_KEY', 'TOKEN'])
    expect(progress).toEqual({ projectId: 'project-1', remaining: [] })
  })

  it('retries only remaining entries on the created project after a partial failure', async () => {
    let creations = 0
    let fail = true
    const saves: string[] = []
    const progress: SubmissionProgress = { projectId: null, remaining: pairs }
    const dependencies = {
      body,
      progress,
      createProject: async () => {
        creations++
        return { id: 'existing-project' }
      },
      putSecret: async ({
        name,
        projectId,
      }: {
        name: string
        value: string
        projectId: string
      }) => {
        expect(projectId).toBe('existing-project')
        saves.push(name)
        if (name === 'TOKEN' && fail) throw new Error('offline')
      },
    }
    await expect(submitProject(dependencies)).rejects.toThrow('offline')
    expect(progress.projectId).toBe('existing-project')
    expect(progress.remaining).toEqual([pairs[1]])
    fail = false
    await submitProject(dependencies)
    expect(creations).toBe(1)
    expect(saves).toEqual(['API_KEY', 'TOKEN', 'TOKEN'])
    expect(progress.remaining).toEqual([])
  })

  it('does not save values when creation fails', async () => {
    let saves = 0
    const progress: SubmissionProgress = { projectId: null, remaining: pairs }
    await expect(
      submitProject({
        body,
        progress,
        createProject: async () => {
          throw new Error('creation failed')
        },
        putSecret: async () => {
          saves++
        },
      }),
    ).rejects.toThrow('creation failed')
    expect(progress.projectId).toBeNull()
    expect(progress.remaining).toEqual(pairs)
    expect(saves).toBe(0)
  })

  it('creates a project with no optional values', async () => {
    const progress: SubmissionProgress = { projectId: null, remaining: [] }
    await submitProject({
      body,
      progress,
      createProject: async () => ({ id: 'empty' }),
      putSecret: async () => {
        throw new Error('unexpected')
      },
    })
    expect(progress.projectId).toBe('empty')
  })
})
