import { kvJsonStore } from '../storage/kv-json-store'

const NAVIGATION_DATABASE = 'atlas-navigation'

export const selectedSessionJsonStore = () => kvJsonStore({ database: NAVIGATION_DATABASE })
