import { EMemoryType, type MemoryEntry } from "./settings-memory-types";

type MemorySpec = Omit<MemoryEntry, "body"> & { fact: string; why: string; how: string };

function memory({ fact, why, how, ...entry }: MemorySpec): MemoryEntry {
  return { ...entry, body: `${fact}\n\n**Why:** ${why}\n**How to apply:** ${how}` };
}

export const GLOBAL_MEMORIES: MemoryEntry[] = [
  memory({
    id: "g1", file: "questions-end-the-turn.md", name: "Questions end the turn", type: EMemoryType.Feedback, recorded: "2026-10-12",
    description: "Design musing gets discussion, not implementation; asking him something means waiting for the answer before building",
    fact: "When a message is a question or a thought out loud, answer it and stop. Do not start building.",
    why: "He once got a half-built feature after asking \"what if we…\" and had to unwind it.",
    how: "End the turn on any question you ask him. Build only once he says to.",
  }),
  memory({
    id: "g2", file: "memory-holds-facts-not-logs.md", name: "Memory holds facts, not logs", type: EMemoryType.Feedback, recorded: "2026-10-09",
    description: "Delete superseded claims outright; no REVERSED/superseded trails or history sections",
    fact: "A memory states what is true now. When a claim changes, rewrite or delete it.",
    why: "History sections made the index grow and put stale claims next to current ones.",
    how: "Edit in place. Put the change itself in git, not in the memory file.",
  }),
  memory({
    id: "g3", file: "linear-cli-not-mcp.md", name: "Linear is reached by CLI, not MCP", type: EMemoryType.Reference, recorded: "2026-09-30",
    description: "Atlas has no Linear MCP; use /opt/homebrew/bin/linear and pass --team ENG explicitly",
    fact: "The Linear CLI is already authenticated against the compai workspace. No default team is set.",
    why: "Reaching for an MCP server that does not exist wastes a turn.",
    how: "Run `linear issue view ENG-123`; every list or query needs `--team ENG`.",
  }),
  memory({
    id: "g4", file: "dennis-new-to-nestjs.md", name: "Dennis: new to NestJS", type: EMemoryType.User, recorded: "2026-10-02",
    description: "Third week at Comp AI; explain framework machinery from first principles, he drives the architecture himself",
    fact: "Dennis is three weeks into Comp AI and has not used NestJS before.",
    why: "Terse answers that assume Nest idioms leave him guessing at what the decorators do.",
    how: "Explain the module and provider model briefly when touching Nest code. Leave architecture choices to him.",
  }),
  memory({
    id: "g5", file: "no-code-comments.md", name: "Don't write code comments", type: EMemoryType.Feedback, recorded: "2026-09-21",
    description: "Rename, extract, or encode in types instead; keep a comment only for facts that live outside the repo",
    fact: "Default to no comment. A comment is a second artifact the compiler cannot check.",
    why: "Comments rot silently when the code beneath them changes.",
    how: "Rename the variable, extract a function, or write a test. Comment only provider quirks that cannot drift.",
  }),
  memory({
    id: "g6", file: "never-git-stash.md", name: "Never use git stash", type: EMemoryType.Feedback, recorded: "2026-09-18",
    description: "Stash has lost uncommitted work twice, including a botched pathspec push; recovery needs git fsck",
    fact: "Do not run `git stash` unless he asks for it.",
    why: "Sibling sessions share one repo, and a stash pop can overwrite their edits.",
    how: "To A/B a test, copy the file aside or use a scratch worktree.",
  }),
  memory({
    id: "g7", file: "gh-job-logs-escape-sequences.md", name: "gh job logs: gh api needs --allow-escape-sequences", type: EMemoryType.Reference, recorded: "2026-10-05",
    description: "Fetch CI logs with gh api, not gh run view, which lacks the flag; strip ANSI with sed",
    fact: "`gh api --allow-escape-sequences repos/<owner>/<repo>/actions/jobs/<id>/logs` returns the raw log.",
    why: "`gh run view --log-failed` truncates or fails on long jobs.",
    how: "Pipe through `sed 's/\\x1b\\[[0-9;]*m//g'` before grepping.",
  }),
  memory({
    id: "g8", file: "merge-plain-squash.md", name: "Merge with plain gh pr merge --squash", type: EMemoryType.Feedback, recorded: "2026-10-01",
    description: "Never pass --delete-branch from a worktree: gh tries to check out main and fails after the merge has already landed",
    fact: "Run `gh pr merge --squash` and nothing else. Remove the worktree and branch yourself afterwards.",
    why: "`--delete-branch` leaves a misleading error on a merge that already succeeded.",
    how: "After merge, `git worktree remove` from the repo root, then `git branch -D`.",
  }),
  memory({
    id: "g9", file: "shell-setup.md", name: "Shell setup", type: EMemoryType.User, recorded: "2026-08-27",
    description: "Warp with zsh, Oh My Zsh and p10k; a bare interactive shell cold-starts in about 0.09s",
    fact: "A slow terminal is never the zshrc. Suspect Warp's own child process waves first.",
    why: "Earlier debugging chased the prompt config for an hour before the real cause showed up.",
    how: "Measure `zsh -i -c exit` before touching dotfiles.",
  }),
  memory({
    id: "g10", file: "concurrent-sessions-are-normal.md", name: "Concurrent sessions are normal", type: EMemoryType.Feedback, recorded: "2026-09-25",
    description: "Files change under you mid-task; prefer new files and anchored edits, and don't trust a workspace-wide check",
    fact: "Another session may edit the same tree while you work. That is expected.",
    why: "A workspace-wide typecheck failing in a file you never touched is usually a sibling's work in progress.",
    how: "Check only the files you own. Use anchored edits instead of rewriting whole files.",
  }),
];

export const ATLAS_MEMORIES: MemoryEntry[] = [
  memory({
    id: "a1", file: "cloud-lifecycle-rebuild.md", name: "Cloud lifecycle rebuild rules", type: EMemoryType.Project, recorded: "2026-10-08",
    description: "One lifecycle record, driveless snapshots, dev-serve pins, API deploys before clients (PR #1270)",
    fact: "Cloud sessions keep one lifecycle record. Snapshots are taken driveless.",
    why: "Two records for one session drifted apart and produced parked sessions that never resumed.",
    how: "Deploy the API before shipping a client that depends on a new lifecycle field.",
  }),
  memory({
    id: "a2", file: "prod-migrations-are-manual.md", name: "Prod migrations are manual", type: EMemoryType.Project, recorded: "2026-10-14",
    description: "Merging a PR with migrations doesn't migrate prod; run db:deploy from packages/db with the prod tier before calling a feature live",
    fact: "Production schema changes only when someone runs `db:deploy` against the prod tier.",
    why: "A merged migration PR looked shipped while prod still had the old schema.",
    how: "After merging, run the deploy and confirm the table or column exists before saying it is live.",
  }),
  memory({
    id: "a3", file: "dev-preview-account.md", name: "Dev preview account is disposable", type: EMemoryType.Reference, recorded: "2026-10-03",
    description: "Reset dennis-preview@rs.local's password freely for login verification; only the hotmail address is real",
    fact: "The preview account exists only for checking login flows in dev.",
    why: "Asking him before each reset blocked verification for no benefit.",
    how: "Reset it whenever a login check needs a known password. Never touch the real account.",
  }),
  memory({
    id: "a4", file: "claude-429-check-plan.md", name: "Claude 429: check the plan before the OAuth code", type: EMemoryType.Reference, recorded: "2026-10-11",
    description: "\"Rate limited\" while Claude Code works means Atlas holds a different, exhausted grant; query /api/oauth/usage first",
    fact: "A 429 from Atlas can come from a different OAuth grant than the one Claude Code uses.",
    why: "The first suspicion fell on the OAuth code path, which was fine.",
    how: "Query the usage endpoint for each stored grant and compare before changing any code.",
  }),
  memory({
    id: "a5", file: "ortho-v4-rearchitecture.md", name: "ortho-v4 re-architecture", type: EMemoryType.Project, recorded: "2026-09-29",
    description: "Greenfield Vercel/PlanetScale/Better Auth port from a pinned v3 commit; v3 keeps shipping until cutover",
    fact: "v4 is a port, not a rewrite of behaviour. The v3 commit it ports from is pinned.",
    why: "Drifting from the pinned commit makes parity checks meaningless.",
    how: "Fix bugs in v3 first when they affect both. Port them over instead of re-deriving.",
  }),
  memory({
    id: "a6", file: "dont-overengineer.md", name: "Don't overengineer; solve real problems", type: EMemoryType.Feedback, recorded: "2026-10-06",
    description: "Fix only observed failures with the smallest fix and no speculative follow-ups; delete stale code without asking",
    fact: "Fix what actually failed. Skip hardening against failures nobody has seen.",
    why: "Speculative guards added review weight and never caught anything.",
    how: "Make the smallest change that fixes the observed failure. Delete dead code you find on the way.",
  }),
  memory({
    id: "a7", file: "prod-decrypt-from-worktree.md", name: "Prod tier decrypts from a worktree via -fk", type: EMemoryType.Reference, recorded: "2026-10-13",
    description: "Point dotenvx -fk at the main checkout's apps/api/envs/.env.keys; never copy it into a worktree",
    fact: "A worktree has no .env.keys. The main checkout's file is the source of truth.",
    why: "Copies of the keys file in worktrees outlive the worktree and leak.",
    how: "Pass `-fk /atlas/workspaces/atlas/apps/api/envs/.env.keys` to dotenvx run.",
  }),
  memory({
    id: "a8", file: "storybook-review-handoff.md", name: "Storybook review is the visual handoff", type: EMemoryType.Feedback, recorded: "2026-10-15",
    description: "Publish the curated review page for UI changes; boot the dev server when the MCP is down",
    fact: "For any UI change he reviews the Storybook page, not a screenshot in chat.",
    why: "Screenshots hide hover, focus and overflow states he wants to poke at.",
    how: "Add or update a story, then hand over its URL.",
  }),
];

export const RS_CRM_MEMORIES: MemoryEntry[] = [
  memory({
    id: "r1", file: "mvp-service-tickets-first.md", name: "MVP reframe: service tickets first", type: EMemoryType.Project, recorded: "2026-09-12",
    description: "The owner's #1 pain is manual service tickets; the legacy app was a never-shipped north star, so design tickets from her real PDFs",
    fact: "The first release is service tickets, built from the PDFs she fills out today.",
    why: "The legacy scope tried to be a full CRM and never shipped.",
    how: "When a feature does not help produce a ticket, it waits.",
  }),
  memory({
    id: "r2", file: "crm-mvp-decisions.md", name: "CRM MVP decisions", type: EMemoryType.Project, recorded: "2026-09-14",
    description: "Ticket is the unit of work, Company is the sole billable entity, QBO from day one, signature required",
    fact: "Billing hangs off Company only. A ticket cannot be closed without a signature.",
    why: "Billing individuals and companies in parallel doubled every invoice rule.",
    how: "Model new billing features against Company. Reject designs that bill a contact.",
  }),
  memory({
    id: "r3", file: "trigger-dev-personal-account.md", name: "trigger.dev lives in his personal account", type: EMemoryType.Reference, recorded: "2026-09-20",
    description: "Not the Comp AI org the CLI defaults to; use the named rs-crm CLI profile, deploys go through the native GitHub integration",
    fact: "Runs and deploys for this project belong to the personal trigger.dev account.",
    why: "The CLI's default profile points at the Comp AI org and shows no runs.",
    how: "Pass `--profile rs-crm` to every trigger.dev command.",
  }),
  memory({
    id: "r4", file: "vercel-api-access.md", name: "Vercel API access for rs-crm", type: EMemoryType.Reference, recorded: "2026-09-27",
    description: "Token comes from the CLI auth.json plus teamId=recycling-solution; the apex domain is canonical and www redirects",
    fact: "Project config lives only in Vercel, not in the repo.",
    why: "Reading the repo for env or domain settings finds nothing.",
    how: "Call the REST API with the CLI's token and the team id. Use the apex domain in links.",
  }),
  memory({
    id: "r5", file: "node-env-production-breaks-react-tests.md", name: "NODE_ENV=production in the shell breaks React tests", type: EMemoryType.Feedback, recorded: "2026-10-04",
    description: "The host shell exports production; pin NODE_ENV=test in every test script",
    fact: "React's production build lacks `act`, so component specs fail with confusing errors.",
    why: "Specs passed in CI and failed locally for a week.",
    how: "Set `NODE_ENV=test` inside the package's test script, not in the caller's shell.",
  }),
  memory({
    id: "r6", file: "linear-is-comp-ai-only.md", name: "Linear is Comp-AI-only", type: EMemoryType.Feedback, recorded: "2026-09-16",
    description: "No ticket gate for branch names here; use a plain feat/<slug> off origin/main",
    fact: "This repo has no Linear workspace behind it.",
    why: "Asking for a ticket id before branching stalled work for nothing.",
    how: "Branch as `feat/<slug>` from origin/main and go.",
  }),
];

export const COMP_MEMORIES: MemoryEntry[] = [
  memory({
    id: "c1", file: "field-required-asterisk.md", name: "Field required asterisk breaks getByLabelText", type: EMemoryType.Feedback, recorded: "2026-10-07",
    description: "Field `required` appends an aria-hidden asterisk, which breaks exact label queries; set it on the control instead",
    fact: "Put `required` on the input, not on `Field`, when a spec queries by label text.",
    why: "The extra \" *\" in the label makes `getByLabelText(\"Email\")` miss.",
    how: "Run the package specs after touching any form that uses Field.",
  }),
  memory({
    id: "c2", file: "csa-prod-credentials.md", name: "CSA prod credentials location", type: EMemoryType.Reference, recorded: "2026-10-10",
    description: "Prod DATABASE_URL and SLACK_BOT_TOKEN live gitignored in the repo's .secrets/ directory",
    fact: "Both values are in `.secrets/` at the repo root and never in the environment.",
    why: "He answered the same \"where are the credentials\" question three times.",
    how: "Read the file directly. Do not ask him for the values.",
  }),
  memory({
    id: "c3", file: "prosemirror-overrides.md", name: "ProseMirror overrides pin the whole family", type: EMemoryType.Project, recorded: "2026-09-24",
    description: "A lone prosemirror-view override nested a second prosemirror-model and broke every editor in prod",
    fact: "Pin view, model, state and transform together or not at all.",
    why: "Two copies of prosemirror-model make schema checks fail at runtime.",
    how: "When bumping one, bump the others in the same override block and check the lockfile for duplicates.",
  }),
  memory({
    id: "c4", file: "strix-model-matrix.md", name: "Strix content-filter model matrix", type: EMemoryType.Project, recorded: "2026-10-16",
    description: "Two models are refused by the provider's filter on Strix's system prompt; sonnet-4-5 works and staging was flipped to it",
    fact: "Only sonnet-4-5 passes the content filter on Strix's system prompt today.",
    why: "The refused models fail with an opaque 400 on every scan.",
    how: "Check this matrix before changing `STRIX_LLM` anywhere.",
  }),
];
