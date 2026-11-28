import { describe, expect, it } from 'bun:test'
import { EAccessScope } from '@dltech/atlas-wire/web'

import { createAccessMemberApi, type AccessMemberTransport } from '../members-api'

describe('access member scope selection', () => {
  for (const scope of [
    { kind: EAccessScope.Personal },
    { kind: EAccessScope.Group, groupId: 'g1' },
    { kind: EAccessScope.Project, projectId: 'p1' },
  ] as const) {
    it(`routes every ${scope.kind} member call and preserves its scope`, async () => {
      const calls: { route: string; input: unknown }[] = []
      const mutation = (route: string) => ({
        mutate: async (input: unknown) => {
          calls.push({ route, input })
        },
      })
      const secretQuery = (route: string) => ({
        query: async (input: unknown) => {
          calls.push({ route, input })
          return { value: 'value' }
        },
      })
      const fileQuery = (route: string) => ({
        query: async (input: unknown) => {
          calls.push({ route, input })
          return { contents: 'contents' }
        },
      })
      const scoped = (prefix: string) => ({
        setSecret: mutation(`${prefix}.setSecret`),
        removeSecret: mutation(`${prefix}.removeSecret`),
        revealSecret: secretQuery(`${prefix}.revealSecret`),
        setFileMount: mutation(`${prefix}.setFileMount`),
        removeFileMount: mutation(`${prefix}.removeFileMount`),
        revealFileMount: fileQuery(`${prefix}.revealFileMount`),
      })
      const api: AccessMemberTransport = {
        secrets: {
          set: mutation('secrets.set'),
          remove: mutation('secrets.remove'),
          reveal: secretQuery('secrets.reveal'),
        },
        personalFileMounts: {
          set: mutation('personalFileMounts.set'),
          remove: mutation('personalFileMounts.remove'),
          reveal: fileQuery('personalFileMounts.reveal'),
        },
        groupResources: scoped('groupResources'),
        projectResources: scoped('projectResources'),
      }
      const members = createAccessMemberApi({ api, scope })
      await members.setSecret({ name: 'KEY', value: 'v', grantId: 'grant1' })
      await members.removeSecret('KEY')
      expect(await members.revealSecret('KEY')).toBe('value')
      await members.setFile({ path: '~/x', contents: 'c', mode: 384, grantId: 'grant1' })
      await members.removeFile('~/x')
      expect(await members.revealFile('~/x')).toBe('contents')
      const extra =
        scope.kind === EAccessScope.Group
          ? { groupId: 'g1' }
          : scope.kind === EAccessScope.Project
            ? { projectId: 'p1' }
            : {}
      expect(calls.map((call) => call.input)).toEqual([
        { ...extra, name: 'KEY', value: 'v', grantId: 'grant1' },
        { ...extra, name: 'KEY' },
        { ...extra, name: 'KEY' },
        { ...extra, path: '~/x', contents: 'c', mode: 384, grantId: 'grant1' },
        { ...extra, path: '~/x' },
        { ...extra, path: '~/x' },
      ])
      const prefix = scope.kind === EAccessScope.Group ? 'groupResources' : 'projectResources'
      expect(calls.map((call) => call.route)).toEqual(
        scope.kind === EAccessScope.Personal
          ? [
              'secrets.set',
              'secrets.remove',
              'secrets.reveal',
              'personalFileMounts.set',
              'personalFileMounts.remove',
              'personalFileMounts.reveal',
            ]
          : [
              'setSecret',
              'removeSecret',
              'revealSecret',
              'setFileMount',
              'removeFileMount',
              'revealFileMount',
            ].map((method) => `${prefix}.${method}`),
      )
    })
  }
})
