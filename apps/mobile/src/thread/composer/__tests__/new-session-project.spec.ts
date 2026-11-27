import { describe, expect, it } from 'bun:test'

import { memoryJsonStore } from '../../../storage/json-store'
import {
  NEW_SESSION_PROJECT_NAME,
  newSessionProjectOf,
  projectIdOf,
  recordOf,
} from '../new-session-project'

describe('projectIdOf', () => {
  it('reads back a recorded project id', () => {
    expect(projectIdOf(recordOf('proj_1'))).toBe('proj_1')
  })

  it('is empty when nothing was recorded', () => {
    expect(projectIdOf(undefined)).toBeNull()
    expect(projectIdOf(null)).toBeNull()
  })

  it('ignores a record from another version', () => {
    expect(projectIdOf({ version: 2, projectId: 'proj_1' })).toBeNull()
  })

  it('ignores a record without a usable project id', () => {
    expect(projectIdOf({ version: 1, projectId: '' })).toBeNull()
    expect(projectIdOf({ version: 1, projectId: 7 })).toBeNull()
    expect(projectIdOf('proj_1')).toBeNull()
  })
})

describe('newSessionProjectOf', () => {
  it('restores the project chosen before the modal closed', async () => {
    const store = memoryJsonStore()
    const project = newSessionProjectOf(store)
    project.save('proj_2')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(await newSessionProjectOf(store).load()).toBe('proj_2')
  })

  it('has no project before one is chosen', async () => {
    const store = memoryJsonStore()
    expect(await newSessionProjectOf(store).load()).toBeNull()
  })

  it('forgets the project when none is chosen', async () => {
    const store = memoryJsonStore()
    const project = newSessionProjectOf(store)
    project.save('proj_3')
    project.save(null)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(await newSessionProjectOf(store).load()).toBeNull()
    expect(await store.keys()).toEqual([])
  })

  it('keeps the last project when saves land together', async () => {
    const store = memoryJsonStore()
    const project = newSessionProjectOf(store)
    project.save('proj_4')
    project.save('proj_5')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(await store.read(NEW_SESSION_PROJECT_NAME)).toEqual(recordOf('proj_5'))
  })
})
