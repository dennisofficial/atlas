import { describe, expect, it, mock } from 'bun:test'

mock.module('@trigger.dev/sdk', () => ({
  schedules: { task: <T>(definition: T): T => definition },
}))

const { heartbeatTask, runHeartbeat } = await import('../trigger/heartbeat.task')

describe('heartbeat task', () => {
  it('registers under the contract id on a fifteen minute cron', () => {
    expect(heartbeatTask).toMatchObject({ id: 'heartbeat', cron: '*/15 * * * *' })
  })

  it('reports whether the database url is present as a boolean', () => {
    process.env['DATABASE_URL'] = 'postgres://user:secret@db.example/atlas'

    const output = runHeartbeat()

    expect(output).toEqual({ taskId: 'heartbeat', databaseUrlPresent: true })
    expect(output).not.toHaveProperty('databaseUrl')
  })

  it('reports a missing database url as false rather than throwing', () => {
    delete process.env['DATABASE_URL']

    expect(runHeartbeat()).toEqual({ taskId: 'heartbeat', databaseUrlPresent: false })
  })
})
