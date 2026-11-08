import * as Updates from 'expo-updates'

import type { UpdatesClient } from './update-check'

export const expoUpdatesClient: UpdatesClient = {
  check: () => Updates.checkForUpdateAsync(),
  fetch: () => Updates.fetchUpdateAsync(),
  reload: () => Updates.reloadAsync(),
}
