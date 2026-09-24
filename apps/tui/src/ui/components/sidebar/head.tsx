import React from "react";

import type { SidebarModel } from "../../../store/sidebar-model";
import { costTone, formatUsd, spendFigures } from "../../../store/sidebar-spend";
import { theme } from "../../theme";
import { ShimmerLine } from "../shimmer-line";
import { truncateCells } from "./cells";

const SEPARATOR = " · ";

const SHIMMER_LEAD_CELLS = 2;

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
}): React.ReactNode {
  const { model } = props;
  if (model.title === null && model.turnCount === 0) return null;

  const figures = spendFigures(model.spend);

  return (
    <box flexDirection="column" flexShrink={0}>
      {model.title === null ? null : model.naming === true ? (
        <ShimmerLine
          label={truncateCells({ text: model.title, cells: props.cells - SHIMMER_LEAD_CELLS })}
          base={theme.bright}
        />
      ) : (
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
