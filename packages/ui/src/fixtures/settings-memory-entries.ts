import { EMemoryType, type MemoryEntry } from './settings-memory-types'

type MemorySpec = Omit<MemoryEntry, 'body'> & {
  fact: string
  why: string
  how: string
  detail?: string
}

function memory({ fact, why, how, detail, ...entry }: MemorySpec): MemoryEntry {
  const core = `${fact}\n\n**Why:** ${why}\n**How to apply:** ${how}`
  return { ...entry, body: detail ? `${core}\n\n${detail}` : core }
}

export const GLOBAL_MEMORIES: MemoryEntry[] = [
  memory({
    name: 'questions-end-the-turn',
    type: EMemoryType.Feedback,
    revision: 3,
    updatedAt: '2026-10-12T11:17:00Z',
    description:
      'Design musing gets discussion, not implementation; asking him something means waiting for the answer before building',
    fact: 'When a message is a question or a thought out loud, answer it and stop. Do not start building.',
    why: 'He once got a half-built feature after asking "what if we…" and had to unwind it.',
    how: 'End the turn on any question you ask him. Build only once he says to.',
  }),
  memory({
    name: 'memory-holds-facts-not-logs',
    type: EMemoryType.Feedback,
    revision: 1,
    updatedAt: '2026-10-09T14:34:00Z',
    description:
      'Delete superseded claims outright; no REVERSED/superseded trails or history sections',
    fact: 'A memory states what is true now. When a claim changes, rewrite or delete it.',
    why: 'History sections made the index grow and put stale claims next to current ones.',
    how: 'Edit in place. Put the change itself in git, not in the memory file.',
  }),
  memory({
    name: 'linear-cli-not-mcp',
    type: EMemoryType.Reference,
    revision: 5,
    updatedAt: '2026-09-30T17:51:00Z',
    description:
      'Atlas has no Linear MCP; use /opt/homebrew/bin/linear and pass --team ENG explicitly',
    fact: 'The Linear CLI is already authenticated against the compai workspace. No default team is set.',
    why: 'Reaching for an MCP server that does not exist wastes a turn.',
    how: 'Run `linear issue view ENG-123`; every list or query needs `--team ENG`.',
  }),
  memory({
    name: 'dennis-new-to-nestjs',
    type: EMemoryType.User,
    revision: 2,
    updatedAt: '2026-10-02T08:08:00Z',
    description:
      'Third week at Comp AI; explain framework machinery from first principles, he drives the architecture himself',
    fact: 'Dennis is three weeks into Comp AI and has not used NestJS before.',
    why: 'Terse answers that assume Nest idioms leave him guessing at what the decorators do.',
    how: 'Explain the module and provider model briefly when touching Nest code. Leave architecture choices to him.',
  }),
  memory({
    name: 'no-code-comments',
    type: EMemoryType.Feedback,
    revision: 7,
    updatedAt: '2026-09-21T11:25:00Z',
    description:
      'Rename, extract, or encode in types instead; keep a comment only for facts that live outside the repo',
    fact: 'Default to no comment. A comment is a second artifact the compiler cannot check.',
    why: 'Comments rot silently when the code beneath them changes.',
    how: 'Rename the variable, extract a function, or write a test. Comment only provider quirks that cannot drift.',
  }),
  memory({
    name: 'never-git-stash',
    type: EMemoryType.Feedback,
    revision: 1,
    updatedAt: '2026-09-18T14:42:00Z',
    description:
      'Stash has lost uncommitted work twice, including a botched pathspec push; recovery needs git fsck',
    fact: 'Do not run `git stash` unless he asks for it.',
    why: 'Sibling sessions share one repo, and a stash pop can overwrite their edits.',
    how: 'To A/B a test, copy the file aside or use a scratch worktree.',
  }),
  memory({
    name: 'gh-job-logs-escape-sequences',
    type: EMemoryType.Reference,
    revision: 4,
    updatedAt: '2026-10-05T17:59:00Z',
    description:
      'Fetch CI logs with gh api, not gh run view, which lacks the flag; strip ANSI with sed',
    fact: '`gh api --allow-escape-sequences repos/<owner>/<repo>/actions/jobs/<id>/logs` returns the raw log.',
    why: '`gh run view --log-failed` truncates or fails on long jobs.',
    how: "Pipe through `sed 's/\\x1b\\[[0-9;]*m//g'` before grepping.",
  }),
  memory({
    name: 'merge-plain-squash',
    type: EMemoryType.Feedback,
    revision: 2,
    updatedAt: '2026-10-01T08:16:00Z',
    description:
      'Never pass --delete-branch from a worktree: gh tries to check out main and fails after the merge has already landed',
    fact: 'Run `gh pr merge --squash` and nothing else. Remove the worktree and branch yourself afterwards.',
    why: '`--delete-branch` leaves a misleading error on a merge that already succeeded.',
    how: 'After merge, `git worktree remove` from the repo root, then `git branch -D`.',
  }),
  memory({
    name: 'shell-setup',
    type: EMemoryType.User,
    revision: 6,
    updatedAt: '2026-08-27T11:33:00Z',
    description:
      'Warp with zsh, Oh My Zsh and p10k; a bare interactive shell cold-starts in about 0.09s',
    fact: "A slow terminal is never the zshrc. Suspect Warp's own child process waves first.",
    why: 'Earlier debugging chased the prompt config for an hour before the real cause showed up.',
    how: 'Measure `zsh -i -c exit` before touching dotfiles.',
  }),
  memory({
    name: 'concurrent-sessions-are-normal',
    type: EMemoryType.Feedback,
    revision: 1,
    updatedAt: '2026-09-25T14:50:00Z',
    description:
      "Files change under you mid-task; prefer new files and anchored edits, and don't trust a workspace-wide check",
    fact: 'Another session may edit the same tree while you work. That is expected.',
    why: "A workspace-wide typecheck failing in a file you never touched is usually a sibling's work in progress.",
    how: 'Check only the files you own. Use anchored edits instead of rewriting whole files.',
  }),
]

export const ATLAS_MEMORIES: MemoryEntry[] = [
  memory({
    name: 'cloud-lifecycle-rebuild',
    type: EMemoryType.Project,
    revision: 3,
    updatedAt: '2026-10-08T17:07:00Z',
    description:
      'One lifecycle record, driveless snapshots, dev-serve pins, API deploys before clients (PR #1270)',
    fact: 'Cloud sessions keep one lifecycle record. Snapshots are taken driveless.',
    why: 'Two records for one session drifted apart and produced parked sessions that never resumed.',
    how: 'Deploy the API before shipping a client that depends on a new lifecycle field.',
  }),
  memory({
    name: 'prod-migrations-are-manual',
    type: EMemoryType.Project,
    revision: 2,
    updatedAt: '2026-10-14T08:24:00Z',
    description:
      "Merging a PR with migrations doesn't migrate prod; run db:deploy from packages/db with the prod tier before calling a feature live",
    fact: 'Production schema changes only when someone runs `db:deploy` against the prod tier.',
    why: 'A merged migration PR looked shipped while prod still had the old schema.',
    how: 'After merging, run the deploy and confirm the table or column exists before saying it is live.',
  }),
  memory({
    name: 'dev-preview-account',
    type: EMemoryType.Reference,
    revision: 3,
    updatedAt: '2026-10-03T11:41:00Z',
    description:
      "Reset dennis-preview@rs.local's password freely for login verification; only the hotmail address is real",
    fact: 'The preview account exists only for checking login flows in dev.',
    why: 'Asking him before each reset blocked verification for no benefit.',
    how: 'Reset it whenever a login check needs a known password. Never touch the real account.',
  }),
  memory({
    name: 'claude-429-check-plan',
    type: EMemoryType.Reference,
    revision: 1,
    updatedAt: '2026-10-11T14:58:00Z',
    description:
      '"Rate limited" while Claude Code works means Atlas holds a different, exhausted grant; query /api/oauth/usage first',
    fact: 'A 429 from Atlas can come from a different OAuth grant than the one Claude Code uses.',
    why: 'The first suspicion fell on the OAuth code path, which was fine.',
    how: 'Query the usage endpoint for each stored grant and compare before changing any code.',
  }),
  memory({
    name: 'ortho-v4-rearchitecture',
    type: EMemoryType.Project,
    revision: 5,
    updatedAt: '2026-09-29T17:15:00Z',
    description:
      'Greenfield Vercel/PlanetScale/Better Auth port from a pinned v3 commit; v3 keeps shipping until cutover',
    fact: 'v4 is a port, not a rewrite of behaviour. The v3 commit it ports from is pinned.',
    why: 'Drifting from the pinned commit makes parity checks meaningless.',
    how: 'Fix bugs in v3 first when they affect both. Port them over instead of re-deriving.',
  }),
  memory({
    name: 'dont-overengineer',
    type: EMemoryType.Feedback,
    revision: 2,
    updatedAt: '2026-10-06T08:32:00Z',
    description:
      'Fix only observed failures with the smallest fix and no speculative follow-ups; delete stale code without asking',
    fact: 'Fix what actually failed. Skip hardening against failures nobody has seen.',
    why: 'Speculative guards added review weight and never caught anything.',
    how: 'Make the smallest change that fixes the observed failure. Delete dead code you find on the way.',
  }),
  memory({
    name: 'prod-decrypt-from-worktree',
    type: EMemoryType.Reference,
    revision: 7,
    updatedAt: '2026-10-13T11:49:00Z',
    description:
      "Point dotenvx -fk at the main checkout's apps/api/envs/.env.keys; never copy it into a worktree",
    fact: "A worktree has no .env.keys. The main checkout's file is the source of truth.",
    why: 'Copies of the keys file in worktrees outlive the worktree and leak.',
    how: 'Pass `-fk /atlas/workspaces/atlas/apps/api/envs/.env.keys` to dotenvx run.',
  }),
  memory({
    name: 'storybook-review-handoff',
    type: EMemoryType.Feedback,
    revision: 1,
    updatedAt: '2026-10-15T14:06:00Z',
    description:
      'Publish the curated review page for UI changes; boot the dev server when the MCP is down',
    fact: 'For any UI change he reviews the Storybook page, not a screenshot in chat.',
    why: 'Screenshots hide hover, focus and overflow states he wants to poke at.',
    how: 'Add or update a story, then hand over its URL.',
  }),
]

export const RS_CRM_MEMORIES: MemoryEntry[] = [
  memory({
    name: 'mvp-service-tickets-first',
    type: EMemoryType.Project,
    revision: 4,
    updatedAt: '2026-09-12T17:23:00Z',
    description:
      "The owner's #1 pain is manual service tickets; the legacy app was a never-shipped north star, so design tickets from her real PDFs",
    fact: 'The first release is service tickets, built from the PDFs she fills out today.',
    why: 'The legacy scope tried to be a full CRM and never shipped.',
    how: 'When a feature does not help produce a ticket, it waits.',
  }),
  memory({
    name: 'crm-mvp-decisions',
    type: EMemoryType.Project,
    revision: 2,
    updatedAt: '2026-09-14T08:40:00Z',
    description:
      'Ticket is the unit of work, Company is the sole billable entity, QBO from day one, signature required',
    fact: 'Billing hangs off Company only. A ticket cannot be closed without a signature.',
    why: 'Billing individuals and companies in parallel doubled every invoice rule.',
    how: 'Model new billing features against Company. Reject designs that bill a contact.',
    detail: [
      '## Entities',
      '- Company: the only billable entity. Carries the QBO customer id, the net terms and the tax status.',
      '- Contact: a person at a Company. Receives tickets and signs them. Never invoiced directly.',
      '- Ticket: one visit or one pickup. Owns line items, photos, the signature and the service date.',
      '',
      '## Ticket lifecycle',
      "1. Draft: created from the dispatcher's phone call or the PDF she fills out today.",
      '2. Scheduled: a technician and a service window are attached.',
      '3. Completed: line items are final and the customer signature is captured on the device.',
      '4. Invoiced: pushed to QuickBooks Online as one invoice per ticket. Never batched across tickets.',
      '',
      '## Rules that came out of the design sessions',
      '- A ticket cannot move to Completed without a signature. There is no override, even for admins.',
      '- Line item prices are copied onto the ticket at creation. Later price list edits never change a past ticket.',
      '- Voiding a ticket after it is invoiced creates a credit memo in QBO instead of deleting the invoice.',
      '- Taxable status is read from the Company at invoice time, so a Company edit applies to every ticket not yet invoiced.',
      '- Net terms default to 30 days. Walk-in cash customers are modelled as a Company named Cash Sale with terms of 0.',
      '',
      '## Out of scope for the MVP',
      'Route optimisation, inventory, multi-location companies, and customer self-service portals. Park these in the backlog and do not model them yet.',
    ].join('\n'),
  }),
  memory({
    name: 'trigger-dev-personal-account',
    type: EMemoryType.Reference,
    revision: 6,
    updatedAt: '2026-09-20T11:57:00Z',
    description:
      'Not the Comp AI org the CLI defaults to; use the named rs-crm CLI profile, deploys go through the native GitHub integration',
    fact: 'Runs and deploys for this project belong to the personal trigger.dev account.',
    why: "The CLI's default profile points at the Comp AI org and shows no runs.",
    how: 'Pass `--profile rs-crm` to every trigger.dev command.',
  }),
  memory({
    name: 'vercel-api-access',
    type: EMemoryType.Reference,
    revision: 1,
    updatedAt: '2026-09-27T14:14:00Z',
    description:
      'Token comes from the CLI auth.json plus teamId=recycling-solution; the apex domain is canonical and www redirects',
    fact: 'Project config lives only in Vercel, not in the repo.',
    why: 'Reading the repo for env or domain settings finds nothing.',
    how: "Call the REST API with the CLI's token and the team id. Use the apex domain in links.",
  }),
  memory({
    name: 'node-env-production-breaks-react-tests',
    type: EMemoryType.Feedback,
    revision: 3,
    updatedAt: '2026-10-04T17:31:00Z',
    description: 'The host shell exports production; pin NODE_ENV=test in every test script',
    fact: "React's production build lacks `act`, so component specs fail with confusing errors.",
    why: 'Specs passed in CI and failed locally for a week.',
    how: "Set `NODE_ENV=test` inside the package's test script, not in the caller's shell.",
  }),
  memory({
    name: 'linear-is-comp-ai-only',
    type: EMemoryType.Feedback,
    revision: 2,
    updatedAt: '2026-09-16T08:48:00Z',
    description: 'No ticket gate for branch names here; use a plain feat/<slug> off origin/main',
    fact: 'This repo has no Linear workspace behind it.',
    why: 'Asking for a ticket id before branching stalled work for nothing.',
    how: 'Branch as `feat/<slug>` from origin/main and go.',
  }),
]

export const COMP_MEMORIES: MemoryEntry[] = [
  memory({
    name: 'field-required-asterisk',
    type: EMemoryType.Feedback,
    revision: 3,
    updatedAt: '2026-10-07T11:05:00Z',
    description:
      'Field `required` appends an aria-hidden asterisk, which breaks exact label queries; set it on the control instead',
    fact: 'Put `required` on the input, not on `Field`, when a spec queries by label text.',
    why: 'The extra " *" in the label makes `getByLabelText("Email")` miss.',
    how: 'Run the package specs after touching any form that uses Field.',
  }),
  memory({
    name: 'csa-prod-credentials',
    type: EMemoryType.Reference,
    revision: 1,
    updatedAt: '2026-10-10T14:22:00Z',
    description:
      "Prod DATABASE_URL and SLACK_BOT_TOKEN live gitignored in the repo's .secrets/ directory",
    fact: 'Both values are in `.secrets/` at the repo root and never in the environment.',
    why: 'He answered the same "where are the credentials" question three times.',
    how: 'Read the file directly. Do not ask him for the values.',
  }),
  memory({
    name: 'prosemirror-overrides',
    type: EMemoryType.Project,
    revision: 5,
    updatedAt: '2026-09-24T17:39:00Z',
    description:
      'A lone prosemirror-view override nested a second prosemirror-model and broke every editor in prod',
    fact: 'Pin view, model, state and transform together or not at all.',
    why: 'Two copies of prosemirror-model make schema checks fail at runtime.',
    how: 'When bumping one, bump the others in the same override block and check the lockfile for duplicates.',
  }),
  memory({
    name: 'strix-model-matrix',
    type: EMemoryType.Project,
    revision: 2,
    updatedAt: '2026-10-16T08:56:00Z',
    description:
      "Two models are refused by the provider's filter on Strix's system prompt; sonnet-4-5 works and staging was flipped to it",
    fact: "Only sonnet-4-5 passes the content filter on Strix's system prompt today.",
    why: 'The refused models fail with an opaque 400 on every scan.',
    how: 'Check this matrix before changing `STRIX_LLM` anywhere.',
  }),
]
