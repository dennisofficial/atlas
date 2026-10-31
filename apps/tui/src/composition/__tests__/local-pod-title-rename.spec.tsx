import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { toRunId, toThreadId } from '@dltech/atlas-core'
import {
  assemblePodThread,
  JsonlEventLog,
  JsonlThreadStore,
  RandomIds,
  SessionRegistry,
  SystemClock,
  type ThreadStorePort,
} from '@dltech/atlas-harness'
import { testRender } from '@opentui/react/test-utils'
import { act, useRef } from 'react'

import type { AtlasApp } from '../compose'
import { appOf, cloudAttachmentOf, cloudBindingOf } from '../session-binding'
import { titleDigestReader } from '../title-digest'
import { useSessionName, type SessionName } from '../use-session-name'
import { fakeBridge } from '../cloud/__tests__/fixture'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { fakeApp, scriptedModelPort } from './fake-app'

const THREAD = toThreadId('brn_parked_rename')
const homes: string[] = []

afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

function NameProbe(args: {
  app: AtlasApp
  threads: ThreadStorePort
  probe: { current: SessionName | null }
}) {
  const started = useRef(true)
  args.probe.current = useSessionName({
    app: args.app,
    threads: args.threads,
    threadId: THREAD,
    started,
    initial: null,
    readDigest: titleDigestReader({ app: args.app, threads: args.threads, threadId: THREAD }),
  })
  return <text>rename</text>
}

describe('user rename of a parked local pod', () => {
  for (const argument of ['Typed title', '']) {
    it(`keeps ${argument === '' ? 'generated /rename' : 'an explicit title'} local without requests`, async () => {
      const home = await mkdtemp(join(tmpdir(), 'atlas-title-tui-'))
      homes.push(home)
      const registry = new SessionRegistry(home)
      const clock = new SystemClock()
      const ids = new RandomIds()
      const log = new JsonlEventLog(home, registry, clock, ids)
      const threads = new JsonlThreadStore(home, registry, clock, ids, log)
      await threads.create({ id: THREAD, workspace: '/w', repo: null })
      await log.append({
        threadId: THREAD,
        runId: toRunId('run_1'),
        drafts: [{ type: 'user-said', text: 'Local transcript for naming' }],
      })
      const bridge = fakeBridge()
      const attachment = bridge.attach({ threadId: THREAD })
      const channel = attachment.channel
      let requests = 0
      channel.request = async () => {
        requests += 1
        throw new Error('a parked rename must not read or write over the channel')
      }
      const base: AtlasApp = {
        ...fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: '' } }) }),
        titler: async () => 'Generated user title',
      }
      const pod = await assemblePodThread({
        bridge,
        attachment,
        threadId: THREAD,
        projectId: null,
        home: threads,
        localCopy: { home, threads, log },
        transcript: {
          log,
          threads,
          ledger: attachment.stores.ledger,
          activity: attachment.stores.activity,
        },
        notice: { notify: () => undefined },
        onReload: async () => undefined,
        open: async () => ({
          threadId: THREAD,
          events: await log.read({ threadId: THREAD }),
          turns: [],
          name: null,
          started: true,
        }),
      })
      const binding = cloudBindingOf({ local: base, bridge, pod })
      const app = appOf({ local: base, binding })
      const cloud = cloudAttachmentOf(binding)
      if (cloud === undefined) throw new Error('missing cloud binding')
      requests = 0
      const probe: { current: SessionName | null } = { current: null }
      const setup = await testRender(
        <NameProbe app={app} threads={cloud.stores.threads} probe={probe} />,
        {
          width: 80,
          height: 5,
        },
      )
      try {
        await setup.flush()
        await act(async () => {
          await probe.current?.renameSession(argument)
        })
        await pod.copySettled()
        expect((await threads.find({ threadId: THREAD }))?.title).toBe(
          argument || 'Generated user title',
        )
        expect(requests).toBe(0)
        expect(bridge.created).toEqual([])
      } finally {
        pod.close()
        await pod.copySettled()
        await teardown(setup)
      }
    })
  }
})
