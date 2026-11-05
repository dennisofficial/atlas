import { config } from '@dotenvx/dotenvx'

config({ path: '.env.production.enc', strict: true, quiet: true })
