export type WorkflowRunSnapshot = {
  id: string
  status: string
  conclusion: string | null
  name: string
  headBranch: string
  url: string
  failedJobs: readonly string[]
}
