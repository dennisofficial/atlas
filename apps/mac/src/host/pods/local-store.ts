import { join } from 'node:path'
import {
  ATLAS_SECRETS_NAME,
  ATLAS_VAULT_KEY_NAME,
  FileSecretsStore,
  FileThreadReadCursor,
  JsonlEventLog,
  JsonlThreadStore,
  JsonlTurnLedger,
  RandomIds,
  SecretCipher,
  SystemClock,
  registryFor,
} from '@dltech/atlas-harness'

export interface ILocalStore {
  home: string
  log: JsonlEventLog
  threads: JsonlThreadStore
  ledger: JsonlTurnLedger
  cursor: FileThreadReadCursor
  secrets: FileSecretsStore
}

export function openLocalStore({ home }: { home: string }): ILocalStore {
  const registry = registryFor({ home })
  const clock = new SystemClock()
  const ids = new RandomIds()
  const log = new JsonlEventLog(home, registry, clock, ids)
  return {
    home,
    log,
    threads: new JsonlThreadStore(home, registry, clock, ids, log),
    ledger: new JsonlTurnLedger({ home, registry }),
    cursor: new FileThreadReadCursor({ registry, log }),
    secrets: new FileSecretsStore({
      file: join(home, ATLAS_SECRETS_NAME),
      cipher: new SecretCipher(join(home, ATLAS_VAULT_KEY_NAME)),
    }),
  }
}
