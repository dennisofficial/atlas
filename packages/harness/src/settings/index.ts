export { environmentLayer, ENVIRONMENT_ORIGIN } from './environment'
export { FileSettingsStore } from './file-store'
export { MemorySettingsStore } from './memory-store'
export {
  ATLAS_MCP_FILE_NAME,
  ATLAS_PLUGINS_DIRECTORY_NAME,
  ATLAS_SETTINGS_NAME,
  COMPAT_MCP_FILE_NAME,
  SKILLS_DIRECTORY_NAME,
  compatMcpFile,
  projectMcpFile,
  projectPluginsDirectory,
  projectSettingsFile,
  projectSkillsDirectory,
  userMcpFile,
  userPluginsDirectory,
  userSettingsFile,
  userSkillsDirectory,
} from './paths'
export { DEFAULT_CONTAINER_IDLE_MINUTES, V1_ONLY_SETTING_DEFINITIONS } from './v1-only-definitions'
export {
  createSettingsService,
  type SettingsService,
  type SettingsSnapshot,
  type SettingsWrite,
} from './service'
