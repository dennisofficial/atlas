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
const provider = process.argv[2] === 'openrouter' ? EAuthProvider.OpenRouter : EAuthProvider.Inference
process.stdout.write(secretOf(await port.read({ provider })))
