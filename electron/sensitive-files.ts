const safeEnvironmentExamples = new Set(['.env.example', '.env.sample', '.env.template'])
const sensitiveDirectories = new Set(['.ssh', '.aws', '.azure', '.gnupg', '.kube'])
const sensitiveFiles = new Set([
  '.env', '.npmrc', '.pypirc', '.netrc', '.git-credentials',
  'credentials', 'credentials.json', 'credentials.yml', 'credentials.yaml',
  'secrets', 'secrets.json', 'secrets.yml', 'secrets.yaml',
  'application_default_credentials.json', 'service-account.json',
])

export function isSensitiveFilePath(value: string): boolean {
  const parts = value.replace(/\\/g, '/').split('/').filter(Boolean).map((part) => part.toLowerCase())
  if (!parts.length) return false
  if (parts.some((part) => sensitiveDirectories.has(part))) return true
  return parts.some((part) => {
    if (safeEnvironmentExamples.has(part)) return false
    if (part === '.env' || part.startsWith('.env.')) return true
    if (sensitiveFiles.has(part)) return true
    if (/^id_(?:rsa|dsa|ecdsa|ed25519)$/.test(part)) return true
    return /\.(?:pem|key|p12|pfx|jks|keystore)$/i.test(part)
  })
}

export function filterSensitiveFileTree<T extends { path: string; kind: 'file' | 'directory'; children?: T[] }>(nodes: T[]): T[] {
  return nodes.flatMap((node) => {
    if (isSensitiveFilePath(node.path)) return []
    if (node.kind !== 'directory' || !node.children) return [node]
    return [{ ...node, children: filterSensitiveFileTree(node.children) }]
  })
}
