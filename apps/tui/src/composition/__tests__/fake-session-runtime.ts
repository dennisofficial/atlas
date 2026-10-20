import type { SessionRuntime } from '@dltech/atlas-harness'

import type { FakeApp } from './fake-app'

export const fakeSessionRuntime = (app: FakeApp): SessionRuntime => ({
  runner: app.runner,
  channel: app.channel,
  log: app.log,
  threads: app.threads,
  ledger: app.ledger,
  intake: app.intake,
  shells: app.shells,
  agents: app.agents,
  services: app.services,
  rewindMachinery: undefined,
  workspace: app.workspace,
  files: app.files,
  attachment: undefined,
})
