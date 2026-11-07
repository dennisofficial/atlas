import { catalogOf, findCard, tallySpend } from '@dltech/atlas-core'
import { generatedCards } from '@dltech/atlas-models'
import type { SessionViewOutput } from '@dltech/atlas-protocol'

import type { ControlSessionViewValue } from './session-view-read'

let catalog: ReturnType<typeof catalogOf> | undefined

const catalogue = () => {
  catalog ??= catalogOf(generatedCards())
  return catalog
}

export const pricedView = (args: {
  at: number
  value: ControlSessionViewValue
}): SessionViewOutput => {
  const { value } = args
  const rows = [...value.spend]
  return {
    at: args.at,
    status: value.status,
    context: value.context,
    spend: {
      rows,
      tally: tallySpend({
        rows,
        priceOf: (ref) => findCard({ catalog: catalogue(), ref })?.cost,
      }),
    },
    checkouts: {
      repos: value.checkouts.repos.map((repo) => ({
        ...repo,
        branches: repo.branches.map((branch) => ({ ...branch })),
      })),
      primary: value.checkouts.primary,
    },
    pullRequests: value.pullRequests.map((link) => ({
      repo: link.repo,
      number: link.number,
      url: link.url,
      branch: link.branch,
      state: link.state,
    })),
  }
}
