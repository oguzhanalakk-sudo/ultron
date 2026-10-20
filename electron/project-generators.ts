// Yığın -> gömülü üretici eşlemesi. Dosya şablonları artık diskteki `templates/`
// klasörüne bağlı değildir; her yığın saf bir TypeScript üreticisidir.
import type { ProjectStack } from './project-template-registry.ts'
import type { DraftFile, GeneratorContext, StackGenerator } from './project-generator-kit.ts'
import { nextFiles, reactFiles, viteFiles } from './project-generators-frontend.ts'
import { expressFiles, electronFiles, fullstackFiles, nodeFiles } from './project-generators-node.ts'
import { fastapiFiles } from './project-generators-python.ts'
import { goFiles, rustFiles } from './project-generators-native.ts'

export const STACK_GENERATORS: Record<ProjectStack, StackGenerator> = {
  react: reactFiles,
  vite: viteFiles,
  express: expressFiles,
  node: nodeFiles,
  'python-fastapi': fastapiFiles,
  electron: electronFiles,
  next: nextFiles,
  fullstack: fullstackFiles,
  go: goFiles,
  rust: rustFiles,
}

/** language-knowledge.ts anahtarlarıyla uyumlu birincil dil. */
export const STACK_LANGUAGE: Record<ProjectStack, string> = {
  react: 'typescript',
  vite: 'typescript',
  express: 'javascript',
  node: 'javascript',
  'python-fastapi': 'python',
  electron: 'typescript',
  next: 'typescript',
  fullstack: 'typescript',
  go: 'go',
  rust: 'rust',
}

/** Yerleşik şablon kimliği -> gömülü üretici yığını. */
export const BUILT_IN_TEMPLATE_STACKS: Record<string, ProjectStack> = {
  'nextjs-react': 'next',
  'fastapi-python': 'python-fastapi',
  'go-api': 'go',
  'rust-axum': 'rust',
  'electron-react': 'electron',
  'node-cli': 'node',
}

export function generateStackFiles(stack: ProjectStack, context: GeneratorContext): DraftFile[] {
  return STACK_GENERATORS[stack](context)
}
