import { loadConfig } from './config'
import { startSession } from './session'

process.env.ATLAS_TESTING = '1'

const config = loadConfig({ env: process.env, cwd: process.cwd() })
if (config) {
  startSession(config)
}
