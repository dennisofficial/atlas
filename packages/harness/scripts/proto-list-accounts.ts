import { AccountStoreProxy } from '../src/cloud/account-store-proxy'
import { CloudSessionStore } from '../src/cloud/cloud-session'
import { atlasCloudFile, atlasVaultFile, atlasVaultKeyFile, fileAccountStore } from '../src/credentials'
import { SystemClock } from '../src/store'

const clock = new SystemClock()
const sessions = new CloudSessionStore({ file: atlasCloudFile(), keyFile: atlasVaultKeyFile() })
const accounts = new AccountStoreProxy({
  local: fileAccountStore({ file: atlasVaultFile(), keyFile: atlasVaultKeyFile(), clock }),
  sessions,
})
for (const account of await accounts.list()) {
  console.log(`${account.provider}  ${JSON.stringify(account).replace(/"(secret|apiKey|accessToken|refreshToken)":"[^"]*"/g, '"$1":"<redacted>"').slice(0, 220)}`)
}
