import { db } from '@dltech/atlas-db'
import { seedThread, useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { seedProject, seedSessionUsers } from '../../../test/web-settings.fake-db'
import { testCipher } from '../session-trpc-test-app'
import { unknownTokenRefresher } from '../user-vercel/vercel-testkit'
import { PROJECT, THREAD } from './scoped-config.fixture'
import { ScopedConfigService } from './scoped-config.service'

const seedSkill = async (args: {
  owner: { userId: string } | { projectId: string }
  name: string
  files: { path: string; content: Uint8Array<ArrayBuffer>; isText: boolean }[]
}) => {
  const skill = await db.orm.public.Skill.create({ ...args.owner, name: args.name })
  await db.orm.public.SkillFile.createAll(
    args.files.map((file) => ({
      skillId: skill.id,
      path: file.path,
      revision: 1,
      contentHash: `hash-${file.path}`,
      content: file.content,
      isText: file.isText,
      size: file.content.byteLength,
    })),
  )
}

describe('ScopedConfigService skill mounts', () => {
  useTestDatabase()
  const cipher = testCipher()
  const scoped = new ScopedConfigService(cipher, unknownTokenRefresher())

  beforeEach(async () => {
    await seedSessionUsers()
    await seedProject({ id: PROJECT, ownerUserId: 'user-a' })
    await seedThread({ db, id: THREAD, userId: 'user-a', projectId: PROJECT })
  })

  it('mounts user skills under the atlas-home skills prefix', async () => {
    await seedSkill({
      owner: { userId: 'user-a' },
      name: 'commit',
      files: [{ path: 'SKILL.md', content: new TextEncoder().encode('# commit'), isText: true }],
    })

    const pod = await scoped.resolveForPod({ userId: 'user-a', projectId: null })

    expect(pod.fileMounts).toEqual([
      {
        path: '@/skills/commit/SKILL.md',
        contents: '# commit',
        mode: 0o600,
        encoding: 'utf8',
      },
    ])
  })

  it('mounts project skills under project-skills, user skills first', async () => {
    await seedSkill({
      owner: { userId: 'user-a' },
      name: 'commit',
      files: [{ path: 'SKILL.md', content: new TextEncoder().encode('# global'), isText: true }],
    })
    await seedSkill({
      owner: { projectId: PROJECT },
      name: 'review',
      files: [{ path: 'SKILL.md', content: new TextEncoder().encode('# project'), isText: true }],
    })

    const pod = await scoped.resolveForPod({ userId: 'user-a', projectId: PROJECT })

    expect(pod.fileMounts.map((mount) => mount.path)).toEqual([
      '@/project-skills/review/SKILL.md',
      '@/skills/commit/SKILL.md',
    ])
    const project = pod.fileMounts.find((mount) => mount.path.includes('project-skills'))
    expect(project?.contents).toBe('# project')
    expect(project?.encoding).toBe('utf8')
  })

  it('encodes binary skill files as base64', async () => {
    const bytes = new Uint8Array([0, 255, 7, 66])
    await seedSkill({
      owner: { userId: 'user-a' },
      name: 'logo',
      files: [{ path: 'mark.png', content: bytes, isText: false }],
    })

    const pod = await scoped.resolveForPod({ userId: 'user-a', projectId: null })

    expect(pod.fileMounts).toEqual([
      {
        path: '@/skills/logo/mark.png',
        contents: Buffer.from(bytes).toString('base64'),
        mode: 0o600,
        encoding: 'base64',
      },
    ])
  })

  it('mounts skills nested deeper than one segment', async () => {
    await seedSkill({
      owner: { projectId: PROJECT },
      name: 'deploy',
      files: [
        {
          path: 'references/runbook.md',
          content: new TextEncoder().encode('run it'),
          isText: true,
        },
      ],
    })

    const pod = await scoped.resolveForPod({ userId: 'user-a', projectId: PROJECT })

    expect(pod.fileMounts.map((mount) => mount.path)).toEqual([
      '@/project-skills/deploy/references/runbook.md',
    ])
  })

  it('mounts nothing when the user has no skills', async () => {
    const pod = await scoped.resolveForPod({ userId: 'user-a', projectId: PROJECT })

    expect(pod.fileMounts).toEqual([])
  })
})
