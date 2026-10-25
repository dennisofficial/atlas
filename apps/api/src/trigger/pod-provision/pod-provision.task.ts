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
import { workerPodProvisionGraph } from './pod-provision-graph'

export async function runPodProvisionTask(
  payload: PodProvisionPayload,
): Promise<PodProvisionOutput> {
  const { deps, dispose } = workerPodProvisionGraph()
  try {
    return await runPodProvision({ payload, deps })
  } finally {
    await dispose()
  }
}

async function failPodProvisionTask(payload: PodProvisionPayload): Promise<void> {
  const { deps, dispose } = workerPodProvisionGraph()
  try {
    await failPodProvision({ payload, signals: deps.signals })
  } finally {
    await dispose()
  }
}

export const podProvisionTask = schemaTask({
  id: POD_PROVISION_TASK_ID,
  schema: podProvisionPayloadSchema,
  retry: { maxAttempts: 1 },
  maxDuration: 300,
  run: runPodProvisionTask,
  onFailure: ({ payload }) => failPodProvisionTask(payload),
}) satisfies PodProvisionTask
