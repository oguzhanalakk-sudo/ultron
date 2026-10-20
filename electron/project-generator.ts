import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createProject, parseProjectRequest } from './project-cli.ts'
import { PROJECT_TEMPLATES } from './project-template-registry.ts'
import { listTemplates } from './project-scaffold.ts'
import {
  installProjectDependencies,
  validateGeneratedBuild,
  verifyProjectGeneration,
} from './project-verifier.ts'

const helpText = `Ultron ile proje oluşturma

Kullanım:
  ultron "React + Express dashboard"
  ultron "my-app --stack react --template dashboard"
  ultron "my-api --stack python-fastapi --template api --dir ./apps/my-api --install --verify"
  npm run new:project -- "my-app --stack electron --verify"

Seçenekler:
  --stack <react|vite|node|express|python-fastapi|electron|next|fullstack>
  --template <web-app|api|desktop|dashboard|fullstack|yerleşik-şablon-id>
  --name <ad>               Proje klasör adını açıkça belirle
  --dir <yol>               Oluşturulacak klasörün tam yolu
  --directory <yol>         Projenin oluşturulacağı üst klasör
  --description <metin>     README açıklaması
  --install                 Bağımlılıkları açıkça kur
  --verify                  Dosyaları ve build adımını doğrula
  --list                    Kullanılabilir şablonları listele
  --help                    Bu yardımı göster
`

export async function runProjectCli(argv: string[] = process.argv): Promise<number> {
  const args = argv.slice(2)
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    console.log(helpText)
    return 0
  }
  if (args.includes('--list')) {
    console.log('Yığınlar:')
    for (const [id, spec] of Object.entries(PROJECT_TEMPLATES)) console.log(`  ${id}\t${spec.framework}\t${spec.template}`)
    console.log('\nYerleşik dosya şablonları:')
    for (const template of listTemplates()) {
      console.log(`  ${template.id}\t${template.category}\t${template.name}${template.available ? '' : '\t(dosyalar eksik; minimal iskelet kullanılabilir)'}`)
    }
    return 0
  }

  try {
    const request = parseProjectRequest(args)
    const artifact = await createProject(request)
    console.log(JSON.stringify({
      name: artifact.name,
      root: artifact.root,
      stack: artifact.stack,
      template: artifact.template,
      files: artifact.files,
      ...(artifact.warnings?.length ? { warnings: artifact.warnings } : {}),
    }, null, 2))

    let exitCode = 0
    if (request.install) {
      console.log('\nBağımlılıklar kuruluyor (--install açıkça istendi)...')
      const installed = await installProjectDependencies(artifact.root, artifact.stack)
      console.log(installed.ok ? 'Kurulum başarılı.' : 'Kurulum başarısız.')
      for (const line of installed.output) console.log(line)
      if (!installed.ok) exitCode = 1
    }

    if (request.verify) {
      console.log('\nProje doğrulanıyor...')
      const structure = await verifyProjectGeneration(artifact.root, artifact.files)
      console.log(JSON.stringify(structure, null, 2))
      const build = await validateGeneratedBuild(artifact.root, artifact.stack)
      console.log(build.ok ? 'Build doğrulandı.' : 'Build doğrulanamadı.')
      for (const line of build.output) console.log(line)
      if (!structure.ok || !build.ok) exitCode = 1
    }
    return exitCode
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runProjectCli(process.argv)
}
