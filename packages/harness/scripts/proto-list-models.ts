import { EAuthProvider, secretOf } from '@dltech/atlas-core'
import { AccountStoreProxy } from '../src/cloud/account-store-proxy'
import { CloudSessionStore } from '../src/cloud/cloud-session'
import { atlasCloudFile, atlasVaultFile, atlasVaultKeyFile, fileAccountStore } from '../src/credentials'
import { BrokeredCredentialPort } from '../src/credentials/brokered-credential-port'
import { SystemClock } from '../src/store'

const clock = new SystemClock()
const sessions = new CloudSessionStore({ file: atlasCloudFile(), keyFile: atlasVaultKeyFile() })
const port = new BrokeredCredentialPort({
  accounts: new AccountStoreProxy({
    local: fileAccountStore({ file: atlasVaultFile(), keyFile: atlasVaultKeyFile(), clock }),
    sessions,
  }),
  sessions,
  clock,
})
const key = secretOf(await port.read({ provider: EAuthProvider.Inference }))
const res = await fetch('https://api.inference.net/v1/models', {
  headers: { authorization: `Bearer ${key}` },
})
const body = (await res.json()) as { data?: { id?: unknown }[] }
const needle = (process.argv[2] ?? '').toLowerCase()
for (const model of body.data ?? []) {
  const id = String(model.id ?? '')
  if (needle === '' || id.toLowerCase().includes(needle)) console.log(id)
}
