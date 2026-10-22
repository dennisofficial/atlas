import { schemaTask } from '@trigger.dev/sdk'
import {
  failPodProvision,
  runPodProvision,
} from '../../api/cloud/sandbox-provisioning/pod-provision-run'
import {
  POD_PROVISION_TASK_ID,
  podProvisionPayloadSchema,
  type PodProvisionOutput,
  type PodProvisionPayload,
  type PodProvisionTask,
} from '../../api/cloud/sandbox-provisioning/pod-provision.contract'
import { workerPodProvisionDeps } from './pod-provision-graph'

export async function runPodProvisionTask(
  payload: PodProvisionPayload,
): Promise<PodProvisionOutput> {
  return runPodProvision({ payload, deps: workerPodProvisionDeps() })
}

export const podProvisionTask = schemaTask({
  id: POD_PROVISION_TASK_ID,
  schema: podProvisionPayloadSchema,
  retry: { maxAttempts: 1 },
  maxDuration: 300,
  run: runPodProvisionTask,
  onFailure: ({ payload }) => failPodProvision({ payload }),
}) satisfies PodProvisionTask
