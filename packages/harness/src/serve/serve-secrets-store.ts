import {
  BACKEND_TRAITS,
  EWebSearchBackend,
  secretNameOf,
  type SecretsPort,
} from '@dltech/atlas-core'

import type { ServeBrokerClient } from './serve-broker-client'

const NO_WRITES =
  'secrets are managed on the operator\'s machine — a cloud session cannot change them from inside its sandbox'

const KEYED_BACKEND_SECRET_NAMES: readonly string[] = Object.values(EWebSearchBackend)
  .filter((backend) => BACKEND_TRAITS[backend].keyLabel !== undefined)
  .map((backend) => secretNameOf(backend))

/**
 * The sandbox-side secrets store. There is no list-everything route for a sandbox token — the
 * store warms exactly the secret names the in-sandbox tools can ask for (the keyed web-search
 * backends) through the thread-scoped broker, one name at a time server-side, and reads stay
 * sync from that cache. Writes have no sandbox-facing route and refuse.
 */
export class ServeSecretsStore implements SecretsPort {
  private readonly broker: ServeBrokerClient
  private held = new Map<string, string>()

  constructor(args: { broker: ServeBrokerClient }) {
    this.broker = args.broker
  }

  async warm(): Promise<void> {
    const secrets = await this.broker.secrets({ names: [...KEYED_BACKEND_SECRET_NAMES] })
    this.held = new Map(secrets.map((secret) => [secret.name, secret.value]))
  }

  origin(): string {
    return `${this.broker.baseUrl}/v1/sandboxes/…/broker/secrets`
  }

  read(name: string): string | undefined {
    return this.held.get(name)
  }

  write(_args: { name: string; value: string }): void {
    throw new Error(NO_WRITES)
  }

  remove(_name: string): void {
    throw new Error(NO_WRITES)
  }
}
