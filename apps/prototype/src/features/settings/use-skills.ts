'use client'

import { useSyncExternalStore } from 'react'

import {
  ESkillFileKind,
  ESkillOwner,
  GLOBAL_SKILLS,
  PROJECT_SKILLS,
  type Skill,
  type SkillFile,
} from './fixtures/settings-skills'

const EMPTY_SKILL_MD = `---\nname: \ndescription: \n---\n\n`

let state: Record<ESkillOwner, Skill[]> = {
  [ESkillOwner.Global]: GLOBAL_SKILLS,
  [ESkillOwner.Project]: PROJECT_SKILLS,
}
const listeners = new Set<() => void>()

function emit(next: Record<ESkillOwner, Skill[]>) {
  state = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function resetSkills() {
  emit({ [ESkillOwner.Global]: GLOBAL_SKILLS, [ESkillOwner.Project]: PROJECT_SKILLS })
}

export function useSkills({ owner }: { owner: ESkillOwner }) {
  const all = useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  )
  const skills = all[owner]

  const updateSkill = (name: string, update: (skill: Skill) => Skill) =>
    emit({
      ...state,
      [owner]: state[owner].map((skill) => (skill.name === name ? update(skill) : skill)),
    })

  const deleteSkills = (names: string[]) =>
    emit({ ...state, [owner]: state[owner].filter((skill) => !names.includes(skill.name)) })

  const createSkill = (name: string): Skill => ({
    name,
    description: '',
    owner,
    updatedAt: new Date().toISOString(),
    files: [{ path: 'SKILL.md', kind: ESkillFileKind.Text, content: EMPTY_SKILL_MD }],
  })

  const addSkill = (skill: Skill) => emit({ ...state, [owner]: [...state[owner], skill] })

  const saveFile = ({ name, path, content }: { name: string; path: string; content: string }) =>
    updateSkill(name, (skill) => ({
      ...skill,
      updatedAt: new Date().toISOString(),
      files: skill.files.map(
        (file): SkillFile => (file.path === path ? { ...file, content } : file),
      ),
    }))

  const addFile = ({ name, file }: { name: string; file: SkillFile }) =>
    updateSkill(name, (skill) => ({ ...skill, files: [...skill.files, file] }))

  const renamePath = ({ name, from, to }: { name: string; from: string; to: string }) =>
    updateSkill(name, (skill) => ({
      ...skill,
      files: skill.files.map((file): SkillFile => {
        if (file.path === from) return { ...file, path: to }
        if (file.path.startsWith(`${from}/`))
          return { ...file, path: to + file.path.slice(from.length) }
        return file
      }),
    }))

  const deletePath = ({ name, path }: { name: string; path: string }) =>
    updateSkill(name, (skill) => ({
      ...skill,
      files: skill.files.filter((file) => file.path !== path && !file.path.startsWith(`${path}/`)),
    }))

  return {
    skills,
    deleteSkills,
    createSkill,
    addSkill,
    saveFile,
    addFile,
    renamePath,
    deletePath,
  }
}
