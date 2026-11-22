import type { ClientSlot } from '@dltech/atlas-plugin-sdk'

export const githubClient: ClientSlot = {
  hooks: [
    {
      name: 'github-subscriptions',
      appliesTo: (event) => event.type.startsWith('subscription-'),
    },
  ],
}
