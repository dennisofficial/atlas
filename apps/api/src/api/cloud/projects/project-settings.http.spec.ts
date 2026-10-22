import type { INestApplication } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { encodeSettingValue } from '@dltech/atlas-wire/web'

mock.module('../../../db', () => ({ db: fake.db }))

import request from 'supertest'
import { GithubService } from '../github/github.service'
import { as, buildSessionApp } from '../session-test-app'
import { sharedWebSettingsDb as fake } from '../web-settings.fake-db'
import { WorkspaceAccessService } from '../workspaces/workspace-access.service'
import { ProjectResourcesController } from './project-resources.controller'
import { ProjectResourcesService } from './project-resources.service'
import { ProjectSettingsService } from './project-settings.service'
import { ProjectsController } from './projects.controller'
import { ProjectsService } from './projects.service'

const BODY = {
  name: 'atlas',
  repo: 'dennisofficial/atlas',
  baseBranch: 'main',
  additionalRepos: [],
}

describe('project settings and workspace link HTTP surface', () => {
  let app: INestApplication
  const http = () => request(app.getHttpServer())

  beforeEach(async () => {
    fake.reset()
    fake.tables.member.rows.push({
      id: 'm1',
      organizationId: 'org-1',
      userId: 'user-a',
      role: 'member',
    })
    app = await buildSessionApp({
      controllers: [ProjectsController, ProjectResourcesController],
      providers: [
        ProjectsService,
        ProjectResourcesService,
        ProjectSettingsService,
        WorkspaceAccessService,
        { provide: GithubService, useValue: { findToken: async () => undefined } },
      ],
    })
  })

  afterEach(() => app.close())

  it('links a project to a workspace the caller belongs to, and keeps it when PUT omits it', async () => {
    await http()
      .post('/v1/projects')
      .set(as('session-a'))
      .send({ ...BODY, organizationId: 'org-2' })
      .expect(404)
    const created = await http()
      .post('/v1/projects')
      .set(as('session-a'))
      .send({ ...BODY, organizationId: 'org-1' })
      .expect(201)
    expect(created.body.organizationId).toBe('org-1')

    const renamed = await http()
      .put(`/v1/projects/${created.body.id}`)
      .set(as('session-a'))
      .send({ ...BODY, name: 'renamed' })
      .expect(200)
    expect(renamed.body.organizationId).toBe('org-1')

    const unlinked = await http()
      .put(`/v1/projects/${created.body.id}`)
      .set(as('session-a'))
      .send({ ...BODY, organizationId: null })
      .expect(200)
    expect(unlinked.body.organizationId).toBeNull()
  })

  it('defaults organizationId to null', async () => {
    const created = await http().post('/v1/projects').set(as('session-a')).send(BODY).expect(201)
    expect(created.body.organizationId).toBeNull()
  })

  it('patches and lists project settings against the project registry', async () => {
    const created = await http().post('/v1/projects').set(as('session-a')).send(BODY).expect(201)
    const base = `/v1/projects/${created.body.id}/settings`

    await http()
      .patch(base)
      .set(as('session-a'))
      .send({
        values: {
          'sandbox.vercelProjectId': encodeSettingValue('prj_1'),
          'model.effort': encodeSettingValue('high'),
        },
      })
      .expect(204)
    await http()
      .patch(base)
      .set(as('session-a'))
      .send({ values: { 'sandbox.vercelTeamId': encodeSettingValue('t') } })
      .expect(400)
    await http()
      .patch(base)
      .set(as('session-a'))
      .send({ values: { 'model.effort': encodeSettingValue('ultra') } })
      .expect(400)
    await http().patch(base).set(as('session-a')).send({ values: {} }).expect(400)

    const read = await http().get(base).set(as('session-a')).expect(200)
    expect(read.body.settings.map((entry: { key: string }) => entry.key)).toEqual([
      'model.effort',
      'sandbox.vercelProjectId',
    ])

    await http()
      .patch(base)
      .set(as('session-a'))
      .send({ values: { 'model.effort': null } })
      .expect(204)
    expect(fake.tables.projectSetting.rows).toHaveLength(1)
  })

  it('404s another user on project settings', async () => {
    const created = await http().post('/v1/projects').set(as('session-a')).send(BODY).expect(201)
    await http().get(`/v1/projects/${created.body.id}/settings`).set(as('session-b')).expect(404)
    await http()
      .patch(`/v1/projects/${created.body.id}/settings`)
      .set(as('session-b'))
      .send({ values: { 'model.effort': encodeSettingValue('high') } })
      .expect(404)
  })
})
