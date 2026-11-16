import { schemaTask } from '@trigger.dev/sdk'
import {
  ARTIFACT_BUILD_TASK_ID,
  artifactBuildPayloadSchema,
  type ArtifactBuildPayload,
  type ArtifactBuildTask,
  type ArtifactBuildTaskOutput,
} from '../../api/cloud/artifacts/artifact-build.contract'
import { failArtifactBuild, runArtifactBuild } from '../../api/cloud/artifacts/artifact-build-run'
import { workerArtifactBuildDeps } from './artifact-build-graph'

export async function runArtifactBuildTask(
  payload: ArtifactBuildPayload,
): Promise<ArtifactBuildTaskOutput> {
  return runArtifactBuild({ payload, deps: workerArtifactBuildDeps() })
}

export const artifactBuildTask = schemaTask({
  id: ARTIFACT_BUILD_TASK_ID,
  schema: artifactBuildPayloadSchema,
  retry: { maxAttempts: 1 },
  maxDuration: 1200,
  run: runArtifactBuildTask,
  onFailure: ({ payload, error }) =>
    failArtifactBuild({ payload, error, deps: workerArtifactBuildDeps() }),
}) satisfies ArtifactBuildTask
