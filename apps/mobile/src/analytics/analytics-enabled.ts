export const analyticsEnabledOf = (args: { apiKey: string | undefined }): boolean =>
  args.apiKey !== undefined && args.apiKey.length > 0
