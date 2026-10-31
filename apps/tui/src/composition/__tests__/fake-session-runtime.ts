import type { SessionActivityPort, SessionRuntime } from '@dltech/atlas-harness'

import type { FakeApp } from './fake-app'

export const unavailableActivity = (): SessionActivityPort => ({
  read: async () => {
    throw new Error('activity unavailable in this fixture')
  },
})

export const fakeSessionRuntime = (app: FakeApp): SessionRuntime => ({
  runner: app.runner,
  channel: app.channel,
  log: app.log,
  threads: app.threads,
  ledger: app.ledger,
  activity: app.activity,
  intake: app.intake,
  shells: app.shells,
  agents: app.agents,
  services: app.services,
  rewindMachinery: undefined,
  workspace: app.workspace,
  files: app.files,
  attachment: undefined,
})
