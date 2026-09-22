/**
 * Mirrors `WORKSPACE_PATH` in `apps/api/src/api/sandboxes/vercel-sandbox.client.ts`, duplicated
 * here rather than imported because `apps/api` carries no in-repo dependency by design (the same
 * reason `MAX_CONTEXT_BUNDLE_BYTES` is duplicated instead of shared).
 */
export const CLOUD_WORKSPACE_PATH = '/workspace'
