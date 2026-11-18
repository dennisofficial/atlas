import type { PullRequestCacheFields } from './github-pull-request-mapping'
import type { PullObservationRead } from './github-user-reads'

export function observationReadOf(args: {
  fields: PullRequestCacheFields
  number: number
}): PullObservationRead {
  const fields = args.fields
  const headSha = fields.headSha
  const baseBranch = 'main'
  const observedAt = new Date().toISOString()

  return {
    pull: {
      number: args.number,
      title: fields.title,
      html_url: fields.url,
      state: fields.state === 'draft' ? 'open' : fields.state,
      draft: fields.state === 'draft',
      merged_at: fields.state === 'merged' ? '2026-11-18T00:00:00Z' : null,
      updated_at: observedAt,
      mergeable: fields.mergeable,
      mergeable_state: fields.mergeClean === true ? 'clean' : 'unknown',
      head: {
        ref: fields.headBranch,
        sha: headSha,
        repo: fields.headRepoFullName === null ? null : { full_name: fields.headRepoFullName },
      },
      base: { ref: baseBranch },
    },
    mergeability: {
      headSha,
      baseBranch,
      mergeable: fields.mergeable,
      mergeClean: fields.mergeClean ?? null,
      observedAt,
    },
  }
}
