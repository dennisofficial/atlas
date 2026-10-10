import { describe, it } from 'bun:test'

describe.skip('/container cloud preflight', () => {
  // slice 08: the preflight refusal guards the lift /container cloud used to drive. The birth path
  // has its own preflight (born-cloud-preflight in cloud/born-cloud.ts), covered with /new.
  it('refuses before anything moves when the credentials are missing', () => {})
  it('a second attempt is not held off by the first refusal', () => {})
})
