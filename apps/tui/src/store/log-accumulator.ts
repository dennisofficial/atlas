import {
  EDecision,
  ETriage,
  EToolEffect,
  estimateEventTokens,
  PLAN_TOOL_NAME,
  planInputSchema,
  planTasks,
  type ActiveWorktree,
  type CallId,
  type ERiskDimension,
  type Event,
  type Grant,
  type PlanTask,
} from "@dltech/atlas-core";

export type ToolEffects = (name: string) => EToolEffect | undefined;

export type LogAccumulator = {
  opening: string | null;
  turnCount: number;
  lastActivity: string | null;
  plan: readonly PlanTask[];
  pendingPlanInputs: Map<CallId, unknown>;
  judgedCount: number;
  pauses: number;
  dimensionTally: Map<ERiskDimension, number>;
  judgeUnreachable: boolean;
  grants: Map<string, Grant>;
  tokens: number;
  treeMutations: number;
  worktree: ActiveWorktree | undefined;
  home: string | null;
  repo: string | null;
};

export const emptyLogAccumulator = (): LogAccumulator => ({
  opening: null,
  turnCount: 0,
  lastActivity: null,
  plan: [],
  pendingPlanInputs: new Map(),
  judgedCount: 0,
  pauses: 0,
  dimensionTally: new Map(),
  judgeUnreachable: false,
  grants: new Map(),
  tokens: 0,
  treeMutations: 0,
  worktree: undefined,
  home: null,
  repo: null,
});

export const cloneLogAccumulator = (acc: LogAccumulator): LogAccumulator => ({
  ...acc,
  pendingPlanInputs: new Map(acc.pendingPlanInputs),
  dimensionTally: new Map(acc.dimensionTally),
  grants: new Map(acc.grants),
});

const foldPlanResult = (args: { acc: LogAccumulator; event: Event & { type: "tool-result" } }) => {
  const input = args.acc.pendingPlanInputs.get(args.event.callId);
  if (input === undefined) return;

  args.acc.pendingPlanInputs.delete(args.event.callId);
  if (args.event.error !== undefined) return;

  const parsed = planInputSchema.safeParse(input);
  if (parsed.success) args.acc.plan = planTasks(parsed.data.tasks);
};

export function foldLogEvent(args: {
  acc: LogAccumulator;
  event: Event;
  effects: ToolEffects;
}): void {
  const { acc, event, effects } = args;
  acc.lastActivity = event.at;
  acc.tokens += estimateEventTokens([event]);

  switch (event.type) {
    case "user-said":
      if (acc.opening === null) acc.opening = event.text;
      acc.turnCount += 1;
      acc.judgeUnreachable = false;
      return;
    case "tool-called":
      if (event.name === PLAN_TOOL_NAME) acc.pendingPlanInputs.set(event.callId, event.input);
      return;
    case "tool-result":
      if (effects(event.name) !== EToolEffect.Read) acc.treeMutations += 1;
      foldPlanResult({ acc, event });
      return;
    case "approval-answered":
      if (
        event.decision === EDecision.Allow &&
        event.editedInput !== undefined &&
        acc.pendingPlanInputs.has(event.callId)
      ) {
        acc.pendingPlanInputs.set(event.callId, event.editedInput);
      }
      return;
    case "classifier-judged": {
      acc.judgedCount += 1;
      if (event.wouldAsk === true) {
        acc.pauses += 1;
        const dimensions =
          event.judgedDimension === undefined ? event.dimensions : [event.judgedDimension];
        for (const dimension of dimensions) {
          acc.dimensionTally.set(dimension, (acc.dimensionTally.get(dimension) ?? 0) + 1);
        }
      }
      if (event.triage === ETriage.Consult && !event.consulted) acc.judgeUnreachable = true;
      return;
    }
    case "permission-granted":
      acc.grants.set(event.grantId, {
        grantId: event.grantId,
        dimensions: event.dimensions,
        scope: event.scope,
        subject: event.subject,
        reason: event.reason,
        seq: event.seq,
      });
      return;
    case "permission-revoked":
      acc.grants.delete(event.grantId);
      return;
    case "worktree-entered":
      acc.worktree = {
        path: event.path,
        branch: event.branch,
        base: event.base,
        adopted: event.adopted ?? false,
      };
      return;
    case "worktree-exited":
      acc.worktree = undefined;
      if (event.returnTo !== undefined) acc.home = event.returnTo;
      return;
    case "directory-changed":
      acc.worktree = undefined;
      acc.home = event.path;
      if (event.repo !== undefined) acc.repo = event.repo;
      return;
    case "location-changed":
      acc.worktree = undefined;
      acc.home = null;
      acc.repo = null;
      return;
  }
}

export function foldLogEvents(args: {
  events: readonly Event[];
  effects: ToolEffects;
}): LogAccumulator {
  const acc = emptyLogAccumulator();
  for (const event of args.events) foldLogEvent({ acc, event, effects: args.effects });
  return acc;
}
