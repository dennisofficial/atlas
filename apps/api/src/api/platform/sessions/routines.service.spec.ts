import { describe, expect, it } from 'bun:test'

import { NotFoundException } from '@nestjs/common'
import type { ControlPlane } from '@dltech/atlas-control'

import type { ProjectAccess } from './project-access'
import { RoutinesService } from './routines.service'

const row = {
  routineId: 'r1',
  userId: 'u1',
  projectId: 'p1',
  name: 'standup',
  prompt: 'post the standup',
  cron: '0 9 * * 1-5',
  timezone: 'Europe/London',
  enabled: true,
  modelRef: null,
  modelEffort: null,
  modelFast: null,
  nextRunAt: '2026-11-20T09:00:00.000Z',
  lastRunAt: null,
  lastSessionId: null,
  createdAt: '2026-11-19T10:00:00.000Z',
  updatedAt: '2026-11-19T10:00:00.000Z',
}

const serviceOf = (readRoutine: ControlPlane['readRoutine']): RoutinesService =>
  new RoutinesService({ readRoutine } as unknown as ControlPlane, {} as unknown as ProjectAccess)

describe('RoutinesService.get', () => {
  it('returns one routine with its full prompt', async () => {
    const service = serviceOf(async ({ routineId, userId }) =>
      routineId === 'r1' && userId === 'u1' ? row : undefined,
    )
    const routine = await service.get({ userId: 'u1', routineId: 'r1', projectId: 'p1' })
    expect(routine.prompt).toBe('post the standup')
    expect(routine.nextRunAt).toBe('2026-11-20T09:00:00.000Z')
  })

  it('answers not found for an id the project does not have', async () => {
    const service = serviceOf(async () => undefined)
    await expect(service.get({ userId: 'u1', routineId: 'gone' })).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('answers not found for a routine of another project', async () => {
    const service = serviceOf(async () => row)
    await expect(
      service.get({ userId: 'u1', routineId: 'r1', projectId: 'p2' }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})
