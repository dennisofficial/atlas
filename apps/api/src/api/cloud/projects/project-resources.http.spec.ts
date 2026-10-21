import type { INestApplication } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../db', async () => {
  const { sharedWebSettingsDb } = await import('../web-settings.fake-db')
  return { db: sharedWebSettingsDb.db }
})

import request from 'supertest'
import { GithubService } from '../github/github.service'
import { as, buildSessionApp } from '../session-test-app'
import { sharedWebSettingsDb as fake } from '../web-settings.fake-db'
import { ProjectResourcesController } from './project-resources.controller'
import { ProjectResourcesService } from './project-resources.service'
import { ProjectSettingsService } from './project-settings.service'
import { ProjectsController } from './projects.controller'
import { ProjectsService } from './projects.service'
import { WorkspaceAccessService } from '../workspaces/workspace-access.service'

const BODY = { name: 'atlas', repo: 'dennisofficial/atlas', baseBranch: 'main', additionalRepos: [] }

describe('project resources HTTP surface', () => {
  let app: INestApplication
  const http = () => request(app.getHttpServer())

  const createAs = async (token: string): Promise<string> => {
    const created = await http().post('/v1/projects').set(as(token)).send(BODY).expect(201)
    return created.body.id as string
  }

  beforeEach(async () => {
    fake.reset()
    app = await buildSessionApp({
      controllers: [ProjectsController, ProjectResourcesController],
      providers: [
        ProjectsService,
        WorkspaceAccessService,
        ProjectResourcesService,
        ProjectSettingsService,
        { provide: GithubService, useValue: { findToken: async () => undefined } },
      ],
    })
  })

  afterEach(() => app.close())

  it('creates with description and shipBehavior defaults and leaves them alone on update', async () => {
    const created = await http().post('/v1/projects').set(as('session-a')).send(BODY).expect(201)
    expect(created.body).toMatchObject({ description: '', shipBehavior: 'open-pr' })

    const detailed = await http()
      .put(`/v1/projects/${created.body.id}`)
      .set(as('session-a'))
      .send({ ...BODY, description: 'the harness', shipBehavior: 'merge' })
      .expect(200)
    expect(detailed.body).toMatchObject({ description: 'the harness', shipBehavior: 'merge' })

    const renamed = await http()
      .put(`/v1/projects/${created.body.id}`)
      .set(as('session-a'))
      .send({ ...BODY, name: 'renamed' })
      .expect(200)
    expect(renamed.body).toMatchObject({ description: 'the harness', shipBehavior: 'merge' })
  })

  it('validates description length and shipBehavior', async () => {
    await http()
      .post('/v1/projects')
      .set(as('session-a'))
      .send({ ...BODY, description: 'x'.repeat(501) })
      .expect(400)
    await http()
      .post('/v1/projects')
      .set(as('session-a'))
      .send({ ...BODY, shipBehavior: 'yolo' })
      .expect(400)
  })

  it('reads and writes the sandbox, validating vcpus', async () => {
    const id = await createAs('session-a')
    const initial = await http().get(`/v1/projects/${id}/sandbox`).set(as('session-a')).expect(200)
    expect(initial.body).toEqual({ vcpus: null, setupScript: '' })

    const saved = await http()
      .put(`/v1/projects/${id}/sandbox`)
      .set(as('session-a'))
      .send({ vcpus: 4, setupScript: 'bun install' })
      .expect(200)
    expect(saved.body).toEqual({ vcpus: 4, setupScript: 'bun install' })

    for (const vcpus of [3, 10, 0]) {
      await http()
        .put(`/v1/projects/${id}/sandbox`)
        .set(as('session-a'))
        .send({ vcpus, setupScript: '' })
        .expect(400)
    }
    await http()
      .put(`/v1/projects/${id}/sandbox`)
      .set(as('session-a'))
      .send({ vcpus: null, setupScript: '' })
      .expect(200)
  })

  it('stores project secrets with a kind and enforces env-style names', async () => {
    const id = await createAs('session-a')
    await http()
      .put(`/v1/projects/${id}/secrets/DATABASE_URL`)
      .set(as('session-a'))
      .send({ value: 'postgres://x', kind: 'env' })
      .expect(204)
    await http()
      .put(`/v1/projects/${id}/secrets/bad-name`)
      .set(as('session-a'))
      .send({ value: 'v' })
      .expect(400)

    const listed = await http().get(`/v1/projects/${id}/secrets`).set(as('session-a')).expect(200)
    expect(listed.body.secrets).toEqual([
      expect.objectContaining({ name: 'DATABASE_URL', kind: 'env', value: 'postgres://x' }),
    ])
    expect(fake.tables.projectSecret.rows[0]?.sealedValue).not.toContain('postgres://x')

    await http().delete(`/v1/projects/${id}/secrets/DATABASE_URL`).set(as('session-a')).expect(204)
    const after = await http().get(`/v1/projects/${id}/secrets`).set(as('session-a')).expect(200)
    expect(after.body.secrets).toEqual([])
  })

  it('stores project MCP servers', async () => {
    const id = await createAs('session-a')
    await http()
      .put(`/v1/projects/${id}/mcp-servers/linear`)
      .set(as('session-a'))
      .send({ transport: { kind: 'http', url: 'https://mcp.linear.app/mcp' } })
      .expect(204)
    await http()
      .put(`/v1/projects/${id}/mcp-servers/broken`)
      .set(as('session-a'))
      .send({})
      .expect(400)

    const listed = await http().get(`/v1/projects/${id}/mcp-servers`).set(as('session-a')).expect(200)
    expect(listed.body.servers).toEqual([
      expect.objectContaining({
        name: 'linear',
        transport: { kind: 'http', url: 'https://mcp.linear.app/mcp' },
      }),
    ])
    await http().delete(`/v1/projects/${id}/mcp-servers/linear`).set(as('session-a')).expect(204)
  })

  it('answers 404 on every sub-route for a project that is not the caller’s', async () => {
    const id = await createAs('session-a')
    const as_b = as('session-b')
    await http().get(`/v1/projects/${id}/sandbox`).set(as_b).expect(404)
    await http().put(`/v1/projects/${id}/sandbox`).set(as_b).send({ vcpus: 2, setupScript: '' }).expect(404)
    await http().get(`/v1/projects/${id}/secrets`).set(as_b).expect(404)
    await http().put(`/v1/projects/${id}/secrets/A`).set(as_b).send({ value: 'v' }).expect(404)
    await http().delete(`/v1/projects/${id}/secrets/A`).set(as_b).expect(404)
    await http().get(`/v1/projects/${id}/mcp-servers`).set(as_b).expect(404)
    await http()
      .put(`/v1/projects/${id}/mcp-servers/x`)
      .set(as_b)
      .send({ disabled: true })
      .expect(404)
    await http().delete(`/v1/projects/${id}/mcp-servers/x`).set(as_b).expect(404)
    await http().get(`/v1/projects/missing/sandbox`).set(as('session-a')).expect(404)
    expect(fake.tables.projectSecret.rows).toHaveLength(0)
    expect(fake.tables.projectMcpServer.rows).toHaveLength(0)
  })

  it('requires a session', async () => {
    await http().get('/v1/projects/p/sandbox').expect(401)
  })
})
