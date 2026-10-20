import path from 'node:path'
import fs from 'node:fs/promises'
import { autoGenerateProjectFromPrompt, parseProjectRequest } from './project-generator.ts'
import { installProjectDependencies, validateGeneratedBuild, verifyProjectGeneration } from './project-verifier.ts'

export async function runProjectCli(argv: string[]) {
  const args = argv.slice(2)
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log('Ultron project generator\n')
    console.log('Örnekler:')
    console.log('  ultron "my-app --stack react --template dashboard"')
    console.log('  ultron "my-app --stack express --install --verify"')
    console.log('  ultron "my-app --stack python-fastapi --template api --dir ./apps/my-api"')
    process.exit(0)
  }

  const prompt = args.join(' ')
  const request = parseProjectRequest(prompt)
  const artifact = await autoGenerateProjectFromPrompt(prompt)

  console.log(JSON.stringify({
    name: artifact.name,
    root: artifact.root,
    stack: artifact.stack,
    template: artifact.template,
    files: artifact.files,
  }, null, 2))

  if (request.install) {
    console.log('Bağımlılıklar kuruluyor...')
    const installResult = await installProjectDependencies(artifact.root, artifact.stack ?? 'react')
    console.log(installResult.ok ? 'Kurulum başarılı.' : 'Kurulum başarısız.')
    console.log(installResult.output.join('\n'))
  }

  if (request.verify) {
    console.log('Doğrulama çalıştırılıyor...')
    const verification = await verifyProjectGeneration(artifact.root)
    console.log(JSON.stringify(verification, null, 2))
    const buildResult = await validateGeneratedBuild(artifact.root, artifact.stack ?? 'react')
    console.log(buildResult.ok ? 'Build doğrulandı.' : 'Build doğrulanamadı.')
    console.log(buildResult.output.join('\n'))
  }

  return artifact
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runProjectCli(process.argv)
}
