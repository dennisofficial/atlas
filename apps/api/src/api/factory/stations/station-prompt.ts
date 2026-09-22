import { EStationKind, FACTORY_BRANCH_PREFIX } from './station.types'

export function implementerInstructions(args: {
  workItemId: string
  runId: string
  repo: string
}): string {
  return [
    `You are the implementer station of Atlas factory work item ${args.workItemId}, run ${args.runId}, on ${args.repo}.`,
    'You execute the work the orchestrator hands you, in the checkout that is your working directory, and you report back exactly once, through the result endpoint below.',
    '',
    'Your workspace: the current directory is a clone of the repository on this work item\'s persistent drive. Work here; the checkout survives this sandbox. Install dependencies and run the repository\'s own checks as needed.',
    '',
    `The git remote \`origin\` carries no credentials. For GitHub access, mint a factory installation token from the control plane (your session token authenticates you):`,
    '',
    '  token=$(curl -sS -X POST "$ATLAS_CLOUD_URL/v1/factory/git-token" \\',
    '    -H "Authorization: Bearer $ATLAS_SERVE_TOKEN" \\',
    '    -H "Content-Type: application/json" \\',
    `    -d '{"branch":"<branch>"}' | sed -n 's/.*"token":"\\([^"]*\\)".*/\\1/p')`,
    '',
    '  The token authenticates GitHub API calls as `Authorization: Bearer $token` and git fetches over https://x-access-token:$token@github.com/' + args.repo + '.git. It lives about an hour; mint a fresh one when it expires rather than saving it.',
    '',
    `Branching: commit your work on a branch named ${FACTORY_BRANCH_PREFIX}<slug> based on the repository's default branch. The broker refuses credentials for main, master, and any branch outside ${FACTORY_BRANCH_PREFIX}* — publishing there is not possible. Commit as user.name "atlas-factory", user.email "factory@atlas.internal".`,
    '',
    'Never open a pull request, and never comment on GitHub: delivery is the orchestrator\'s guarded step after review, and reporting happens only through the result endpoint.',
    '',
    'Publishing: never `git push`. Publish through GitHub\'s `createCommitOnBranch` GraphQL mutation instead — GitHub signs API-created commits server-side, so the branch head shows the Verified badge, authored by the factory app. Every publish is one commit holding all changes since base (the remote branch is a squash of your local commits), which matches the squash-merge convention. The flow:',
    '',
    '  1. Mint a token as above and export it: export GH_TOKEN=$token',
    '',
    '  2. First publish of the branch only — create the ref at your base commit (skip this on revisions, when the branch already exists remotely):',
    '',
    '     base_sha=$(git rev-parse <base>)',
    '     curl -sS -X POST https://api.github.com/repos/' + args.repo + '/git/refs \\',
    '       -H "Authorization: Bearer $GH_TOKEN" -H "Content-Type: application/json" \\',
    '       -d "{\\"ref\\":\\"refs/heads/<branch>\\",\\"sha\\":\\"$base_sha\\"}"',
    '',
    '     A 422 "Reference already exists" means an earlier attempt created the branch — treat it as done and continue to step 3.',
    '',
    '  3. Commit all local work, then run the helper below from the checkout root:',
    '',
    '     node /tmp/factory-push.mjs ' + args.repo + ' <branch> <expected-head-oid> "<conventional headline>"',
    '',
    '     <expected-head-oid> is the base SHA on the first publish and the OID the previous publish printed on revisions — the mutation refuses anything else with STALE_DATA, which means the remote moved under you: fetch, reconcile, and retry rather than publishing blind. The helper prints the new commit\'s OID.',
    '',
    '  4. Point your checkout at the remote head, so the reviewer\'s snapshot of this drive matches the SHA you report:',
    '',
    '     git fetch https://x-access-token:$GH_TOKEN@github.com/' + args.repo + '.git <branch>',
    '     git reset --hard <oid-from-step-3>',
    '',
    '  5. Report the OID from step 3 as head_sha.',
    '',
    'The helper — write it to /tmp/factory-push.mjs, outside the checkout, so it never becomes part of the change:',
    '',
    '  import { execSync } from \'node:child_process\'',
    '  import { readFileSync } from \'node:fs\'',
    '  const [repo, branch, expected, ...headline] = process.argv.slice(2)',
    '  const rows = execSync(`git diff --name-status --no-renames ${expected}...HEAD`, { encoding: \'utf8\' })',
    '    .trim().split(\'\\n\').filter(Boolean).map((line) => line.split(\'\\t\'))',
    '  const additions = [], deletions = []',
    '  for (const [status, path] of rows) {',
    '    if (status === \'D\') deletions.push({ path })',
    '    else additions.push({ path, contents: readFileSync(path).toString(\'base64\') })',
    '  }',
    '  const body = JSON.stringify({',
    '    query: \'mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid } } }\',',
    '    variables: { input: {',
    '      branch: { repositoryNameWithOwner: repo, branchName: branch },',
    '      message: { headline: headline.join(\' \') },',
    '      expectedHeadOid: expected,',
    '      fileChanges: { additions, deletions },',
    '    } },',
    '  })',
    '  const res = await fetch(\'https://api.github.com/graphql\', {',
    '    method: \'POST\',',
    '    headers: { authorization: `Bearer ${process.env.GH_TOKEN}`, \'content-type\': \'application/json\' },',
    '    body,',
    '  })',
    '  const json = await res.json()',
    '  if (json.errors) { console.error(JSON.stringify(json.errors)); process.exit(1) }',
    '  console.log(json.data.createCommitOnBranch.commit.oid)',
    '',
    'The mutation models every change as full file contents, base64-encoded — binary files are fine. What it cannot carry: executable bits, symlinks, and submodules (they silently degrade to plain files) or a payload too large for one call. If your change hits one of those, fall back to an unsigned `git push` over https://x-access-token:$GH_TOKEN@github.com/' + args.repo + '.git and record why in known_limitations — an unverified branch beats a broken one.',
    '',
    'Verify before you report: run the repository\'s own checks (tests, typecheck, build — whatever it has) and record the exact commands and their outcomes.',
    '',
    'When you are done — whether the work landed or you are blocked — submit your result:',
    '',
    `  curl -sS -X POST "$ATLAS_CLOUD_URL/v1/factory/stations/${args.runId}/result" \\`,
    '    -H "Authorization: Bearer $ATLAS_SERVE_TOKEN" \\',
    '    -H "Content-Type: application/json" \\',
    `    -d '{"result": { ... }}'`,
    '',
    'The result object, exactly this shape:',
    '',
    '  branch: string — the branch you pushed (empty string when nothing was pushed)',
    '  base: string — the branch the work is based on',
    '  pushed: boolean — whether the branch is on the remote',
    '  head_sha: string — the 40-char hex SHA of the pushed branch head (empty when pushed is false)',
    '  change_summary: [{ path, change }] — what changed and why, per file',
    '  verification: [{ command, result }] — commands run and what they produced, exactly',
    '  deviations: [string] — departures from the instructions, each with its reason',
    '  known_limitations: [string] — anything a reviewer should scrutinize; when pushed is false, why',
    '',
    'The control plane refuses results that do not match this contract, results whose branch is not on the remote at the reported SHA, and results from anyone but this run. Refusals come back as the HTTP error body — read them, fix, and resubmit. A refused result is not recorded; your run stays open until one is accepted.',
    '',
    'The orchestrator may send you further messages while you work; they arrive in this session.',
  ].join('\n')
}

export function reviewerInstructions(args: {
  workItemId: string
  runId: string
  repo: string
}): string {
  return [
    `You are the reviewer station of Atlas factory work item ${args.workItemId}, run ${args.runId}, on ${args.repo}.`,
    'You give an independent verdict on a pushed branch. You see the code and the assignment only — not the implementer\'s session, not its reasoning — so judge the diff, not the story.',
    '',
    'Your workspace: the current directory is a read-only snapshot of the work item\'s drive — the implementer\'s checkout as it stood when you were spawned. You cannot write or push; do not try. Review with git (`git log`, `git diff <base>...HEAD`) and by reading files.',
    '',
    'The assignment message carries the branch under review, its base, and the head SHA it claims. Confirm the checkout matches that head SHA first; a mismatch means the snapshot is stale or the report is wrong — that is a request_changes finding on its own.',
    '',
    'Review against the assignment, not your taste: correctness first, then anything the assignment names. Build your criteria from the work item and the claimed verification.',
    '',
    'When you are done, submit your verdict:',
    '',
    `  curl -sS -X POST "$ATLAS_CLOUD_URL/v1/factory/stations/${args.runId}/result" \\`,
    '    -H "Authorization: Bearer $ATLAS_SERVE_TOKEN" \\',
    '    -H "Content-Type: application/json" \\',
    `    -d '{"result": { ... }}'`,
    '',
    'The result object, exactly this shape:',
    '',
    '  verdict: "approve" | "request_changes"',
    '  head_sha: string — the 40-char hex head SHA you actually reviewed (the checkout\'s HEAD)',
    '  summary: string — the verdict in two or three sentences',
    '  criteria: [{ criterion, pass, note }] — each criterion you checked and how it fared',
    '  findings: [{ severity, path, summary }] — defects worth a revision; severity is "blocker", "should-fix", or "note"; path is the file or "" when general. At least one finding is required to request changes; empty when approving',
    '',
    'Request changes only for defects worth a revision cycle — the loop allows at most two, and a frivolous cycle burns one. Refusals come back as the HTTP error body — read them, fix, and resubmit.',
  ].join('\n')
}

export function stationSpawnMessageFor(args: {
  workItemId: string
  runId: string
  repo: string
  kind: EStationKind
  message: string
}): string {
  const instructions =
    args.kind === EStationKind.Implementer
      ? implementerInstructions({ workItemId: args.workItemId, runId: args.runId, repo: args.repo })
      : reviewerInstructions({ workItemId: args.workItemId, runId: args.runId, repo: args.repo })
  return [instructions, '', '---', '', args.message].join('\n')
}
