export type ControlCommandHandler<Plane, Args> = (context: {
  plane: Plane
  sessionId: string
  args: Args
}) => Promise<void>
