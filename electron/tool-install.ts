import { TOOL_DEFINITIONS, type ToolAvailability } from './tool-catalog.ts'

export type ToolInstallPlan = {
  tool: string
  status: 'missing' | 'available' | 'blocked'
  installCommand?: string
  reason?: string
}

const installHints: Record<string, string> = {
  git: 'winget install --id Git.Git -e',
  gh: 'winget install --id GitHub.cli -e',
  node: 'winget install OpenJS.NodeJS.LTS',
  python: 'winget install Python.Python.3.12',
  dotnet: 'winget install Microsoft.DotNet.SDK.8',
  docker: 'winget install Docker.DockerDesktop',
}

export async function getToolInstallPlan(tools: string[], detect: (name: string) => Promise<ToolAvailability>) {
  const plans: ToolInstallPlan[] = []
  for (const rawTool of Array.isArray(tools) ? tools.slice(0, 64) : []) {
    const tool = String(rawTool).trim().toLowerCase()
    const definition = TOOL_DEFINITIONS[tool]
    if (!definition) { plans.push({ tool, status: 'blocked', reason: 'Araç tanımı yok.' }); continue }
    const detected = await detect(tool)
    if (detected.available) { plans.push({ tool, status: 'available', reason: 'Kurulu.' }); continue }
    plans.push({ tool, status: 'missing', installCommand: installHints[tool], reason: definition.installHint ?? 'Kurulum gerektirir.' })
  }
  return plans
}
