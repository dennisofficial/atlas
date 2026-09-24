import {
  EExecutionLocation,
  EPlanStatus,
  type Event,
  type Grant,
} from "@dltech/atlas-core";

import {
  EShellStatus,
  TEAMMATE_AGENT_TYPE,
  type BoundPort,
  type SandboxContainer,
  type SandboxLimits,
  type ShellSnapshot,
  type TurnSpend,
} from "@dltech/atlas-harness";

import { commonestDimension, type ClassifierFold } from "./classifier-fold";
import { foldLogEvents, type LogAccumulator } from "./log-accumulator";
import type { SidebarCloud } from "./cloud-state";
import { truncateCells } from "../ui/components/sidebar/cells";
import { orderSections, type SidebarSection } from "../ui/sidebar-section";
import type { TurnClock } from "../ui/turn-clock";
import {
  NOTHING_TALLIED,
  sidebarSpendOf,
  type ModelPriceLookup,
  type SidebarSpend,
} from "./sidebar-spend";
import { TITLE_CELLS, oneLineOf } from "./sidebar-text";
import type { SidebarAgentFold, SidebarSubagent } from "./subagent-row";

export enum ESidebarTaskState {
  Done = "done",
  Running = "running",
  Pending = "pending",
}

export type SidebarTask = {
  id: string;
  label: string;
  state: ESidebarTaskState;
  activeForm?: string | undefined;
};

export type SidebarTeammate = {
  id: string;
  name: string;
  activity: string | null;
};

export type SidebarModel = {
  title: string | null;
  turnCount: number;
  spend: SidebarSpend;
  lastActivity: string | null;
  naming?: boolean;
  todo?: readonly SidebarTask[];
  subagents?: readonly SidebarSubagent[];
  crewFold?: SidebarAgentFold;
  teammates?: readonly SidebarTeammate[];
  sections?: readonly SidebarSection[];
  classifier?: ClassifierFold;
  grants?: readonly Grant[];
  container?: SidebarContainer;
  cloud?: SidebarCloud;
};

export type SidebarLimits = SandboxLimits;

export type SidebarContainer = SandboxContainer;

export const IDLE_SIDEBAR: SidebarModel = {
  title: null,
  turnCount: 0,
  spend: NOTHING_TALLIED,
  lastActivity: null,
};

const TASK_STATE_OF: Record<EPlanStatus, ESidebarTaskState> = {
  [EPlanStatus.Pending]: ESidebarTaskState.Pending,
  [EPlanStatus.InProgress]: ESidebarTaskState.Running,
  [EPlanStatus.Completed]: ESidebarTaskState.Done,
};

const sameSpend = (left: SidebarSpend, right: SidebarSpend): boolean =>
  left.costUsd === right.costUsd &&
  left.totals.turns === right.totals.turns &&
  left.totals.steps === right.totals.steps &&
  left.totals.inputTokens === right.totals.inputTokens &&
  left.totals.outputTokens === right.totals.outputTokens &&
  left.totals.cacheReadTokens === right.totals.cacheReadTokens &&
  left.totals.cacheWriteTokens === right.totals.cacheWriteTokens

export const sameSidebar = (left: SidebarModel, right: SidebarModel): boolean =>
  left.title === right.title &&
  left.turnCount === right.turnCount &&
  sameSpend(left.spend, right.spend) &&
  left.lastActivity === right.lastActivity &&
  left.naming === right.naming &&
  left.todo === right.todo &&
  left.subagents === right.subagents &&
  left.crewFold === right.crewFold &&
  left.teammates === right.teammates &&
  left.sections === right.sections &&
  left.classifier === right.classifier &&
  left.grants === right.grants

export type SidebarEventFold = {
  opening: string | null;
  turnCount: number;
  lastActivity: string | null;
  todo: readonly SidebarTask[];
  classifier: ClassifierFold | null;
  grants: readonly Grant[];
};

export function sidebarFoldFrom(acc: LogAccumulator): SidebarEventFold {
  return {
    opening: acc.opening === null ? null : oneLineOf(acc.opening),
    turnCount: acc.turnCount,
    lastActivity: acc.lastActivity,
    todo: acc.plan.map((task) => ({
      id: String(task.ordinal),
      label: task.text,
      state: TASK_STATE_OF[task.status],
      ...(task.activeForm === undefined ? {} : { activeForm: task.activeForm }),
    })),
    classifier:
      acc.judgedCount === 0
        ? null
        : {
            pauses: acc.pauses,
            turns: acc.turnCount,
            topDimension: commonestDimension(acc.dimensionTally),
            judgeUnreachable: acc.judgeUnreachable,
          },
    grants: [...acc.grants.values()].sort((one, other) => one.seq - other.seq),
  };
}

export function sidebarFoldOf(events: readonly Event[]): SidebarEventFold {
  return sidebarFoldFrom(foldLogEvents({ events, effects: () => undefined }));
}

export function sidebarFrom(args: {
  fold: SidebarEventFold;
  turn: TurnClock;
  turns?: readonly TurnSpend[] | undefined;
  priceOf?: ModelPriceLookup | undefined;
  name?: string | null | undefined;
  naming?: boolean | undefined;
}): SidebarModel {
  const { fold, turn } = args;
  const name = args.name ?? null;

  const spend = sidebarSpendOf({
    turns: args.turns ?? [],
    liveOutputTokens: turn.startedAt === null ? 0 : turn.outputTokens,
    liveInput: turn.startedAt === null ? undefined : turn.input,
    priceOf: args.priceOf,
  });
  const named = name === null ? null : oneLineOf(name);
  const titleText = named ?? fold.opening;

  return {
    title:
      titleText === null ? null : truncateCells({ text: titleText, cells: TITLE_CELLS }),
    turnCount: fold.turnCount,
    spend,
    lastActivity: fold.lastActivity,
    ...(args.naming === true && name === null ? { naming: true } : {}),
    ...(fold.todo.length === 0 ? {} : { todo: fold.todo }),
    ...(fold.classifier === null ? {} : { classifier: fold.classifier }),
    ...(fold.grants.length === 0 ? {} : { grants: fold.grants }),
  };
}

export function deriveSidebar(args: {
  events: readonly Event[];
  turn: TurnClock;
  turns?: readonly TurnSpend[] | undefined;
  priceOf?: ModelPriceLookup | undefined;
  name?: string | null | undefined;
  naming?: boolean | undefined;
}): SidebarModel {
  return sidebarFrom({
    fold: sidebarFoldOf(args.events),
    turn: args.turn,
    turns: args.turns,
    priceOf: args.priceOf,
    name: args.name,
    naming: args.naming,
  });
}

/**
 * A crew with nothing left to show takes its heading with it rather than leaving a tally behind:
 * the whole point of retiring a row is the cells it gives back, and `/agents` is where a settled
 * child is read from once the panel has let it go.
 */
export function withCrew(args: {
  model: SidebarModel;
  subagents: readonly SidebarSubagent[];
  fold?: SidebarAgentFold;
}): SidebarModel {
  const { model, subagents } = args;
  if (subagents.length === 0) return model;

  const fold = args.fold;
  if (fold === undefined || fold.hidden === 0) return { ...model, subagents };

  return { ...model, subagents, crewFold: fold };
}

export type CrewTiers = {
  teammates: readonly SidebarSubagent[];
  subagents: readonly SidebarSubagent[];
};

export function crewTiersOf(subagents: readonly SidebarSubagent[]): CrewTiers {
  return {
    teammates: subagents.filter((subagent) => subagent.agentType === TEAMMATE_AGENT_TYPE),
    subagents: subagents.filter((subagent) => subagent.agentType !== TEAMMATE_AGENT_TYPE),
  };
}

export function withSections(args: {
  model: SidebarModel;
  sections: readonly SidebarSection[];
}): SidebarModel {
  const sections = orderSections(args.sections);
  if (sections.length === 0) return args.model;

  return { ...args.model, sections };
}

export function exposedPortsOf(args: {
  shells: readonly ShellSnapshot[];
}): readonly BoundPort[] {
  return args.shells
    .flatMap((shell) => {
      if (shell.status !== EShellStatus.Running || shell.exposure === undefined) return [];
      const { containerPort, hostPort } = shell.exposure;
      return [{ containerPort, hostPort }];
    })
    .sort((left, right) => left.containerPort - right.containerPort);
}

export function containerPillOf(args: {
  location: EExecutionLocation;
  container: SidebarContainer;
  exposed: readonly BoundPort[];
}): SidebarContainer | null {
  if (args.location !== EExecutionLocation.Docker) return null;

  const { state, image, label, name, limits, reason } = args.container;
  return {
    state,
    image,
    label,
    ...(name === undefined ? {} : { name }),
    ...(limits === undefined ? {} : { limits }),
    ports: args.exposed,
    ...(reason === undefined ? {} : { reason }),
  };
}

export function withContainer(args: {
  model: SidebarModel;
  container: SidebarContainer | null;
}): SidebarModel {
  if (args.container === null) return args.model;

  return { ...args.model, container: args.container };
}

export function withCloud(args: {
  model: SidebarModel;
  cloud: SidebarCloud | null;
}): SidebarModel {
  if (args.cloud === null) return args.model;

  return { ...args.model, cloud: args.cloud };
}
