import React from "react";

import type { SidebarModel } from "../../../store/sidebar-model";
import { costTone, formatUsd, spendFigures } from "../../../store/sidebar-spend";
import { theme } from "../../theme";
import { NAMING_SIDEBAR_LINE, titleWithin } from "../../naming-frames";
import { ENamingPhase, NamingLine, type NamingState } from "../naming-line";
import { truncateCells } from "./cells";

const SEPARATOR = " · ";

/**
 * The animation is one row: a rename of a name longer than the column holds the noise and glides
 * within the row's cells, and the answer is clipped the same way the settled title truncates, so
 * the head never grows a second line mid-rename.
 */
const clampToRow = (args: { state: NamingState; cells: number }): NamingState => {
  const startCells = Math.min(args.state.startCells, args.cells);
  if (args.state.phase === ENamingPhase.Generating) {
    return { ...args.state, startCells };
  }
  return {
    ...args.state,
    startCells,
    target:
      args.state.target === null
        ? null
        : titleWithin({ title: args.state.target, cells: args.cells }),
  };
};

const turnsAndCost = (model: SidebarModel): string => {
  const turns = `${model.turnCount} ${model.turnCount === 1 ? "turn" : "turns"}`;
  const { costUsd } = model.spend;
  if (costUsd === null) return turns;

  return `${turns}${SEPARATOR}${formatUsd(costUsd)}`;
};

function TurnsAndCostLine(props: { model: SidebarModel; cells: number }): React.ReactNode {
  const { costUsd } = props.model.spend;
  const label = truncateCells({ text: turnsAndCost(props.model), cells: props.cells });

  if (costUsd === null || label !== turnsAndCost(props.model)) {
    return <text fg={theme.hint}>{label}</text>;
  }

  const turns = `${props.model.turnCount} ${props.model.turnCount === 1 ? "turn" : "turns"}`;

  return (
    <text>
      <span fg={theme.hint}>{`${turns}${SEPARATOR}`}</span>
      <span fg={costTone(costUsd)}>{formatUsd(costUsd)}</span>
    </text>
  );
}

/**
 * No model and no thread: the footer carries what is answering, and a fork of the
 * conversation belongs to the session picker rather than here — this says `git` instead.
 */
export function HeadSection(props: {
  model: SidebarModel;
  cells: number;
  /** The naming animation's state; set while a rename or first titling is in flight. */
  naming?: NamingState | null | undefined;
}): React.ReactNode {
  const { model } = props;
  if (model.title === null && model.turnCount === 0 && props.naming == null) return null;

  const figures = spendFigures(model.spend);

  return (
    <box flexDirection="column" flexShrink={0}>
      {props.naming != null ? (
        <NamingLine state={clampToRow({ state: props.naming, cells: props.cells })} line={NAMING_SIDEBAR_LINE} />
      ) : model.title === null ? null : (
        <text fg={theme.bright}>
          {truncateCells({ text: model.title, cells: props.cells })}
        </text>
      )}
      {model.turnCount === 0 ? null : (
        <TurnsAndCostLine model={model} cells={props.cells} />
      )}
      {figures === null ? null : (
        <text fg={theme.dim}>
          {truncateCells({ text: figures, cells: props.cells })}
        </text>
      )}
    </box>
  );
}
