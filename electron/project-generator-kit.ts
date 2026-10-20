// Üretici dosyaları için ortak tipler ve yardımcılar. Kullanıcı verisi hiçbir zaman
// kod olarak değerlendirilmez; yalnızca temizlenmiş metin olarak gömülür.

export type GeneratorContext = {
  /** Güvenli klasör adı (slug). */
  name: string
  /** Serbest metin açıklama; koda gömülmeden önce `safeText` ile temizlenmelidir. */
  description: string
}

export type DraftFile = {
  path: string
  purpose: string
  content: string
}

export type StackGenerator = (context: GeneratorContext) => DraftFile[]

/** Koda/HTML'e güvenle gömülebilecek tek satırlık düz metin. */
export function safeText(value: string, max = 200): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/[<>&"'`$\\{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/** README gibi Markdown alanları için çok satırlı olmayan açıklama. */
export function markdownText(value: string, max = 1000): string {
  return value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ').replace(/\r/g, '').trim().slice(0, max)
}

export function ensureTrailingNewline(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`
}

export function jsonFile(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

export function draft(path: string, purpose: string, content: string): DraftFile {
  return { path, purpose, content: ensureTrailingNewline(content) }
}

export function packageManifest(
  name: string,
  options: {
    scripts: Record<string, string>
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    module?: boolean
    extra?: Record<string, unknown>
  },
): string {
  return jsonFile({
    name,
    private: true,
    version: '1.0.0',
    ...(options.module === false ? {} : { type: 'module' }),
    ...(options.extra ?? {}),
    scripts: options.scripts,
    ...(options.dependencies && Object.keys(options.dependencies).length ? { dependencies: options.dependencies } : {}),
    ...(options.devDependencies && Object.keys(options.devDependencies).length ? { devDependencies: options.devDependencies } : {}),
  })
}

export function readme(context: GeneratorContext, title: string, sections: Array<[string, string]>): string {
  const body = sections.map(([heading, text]) => `## ${heading}\n\n${text.trim()}\n`).join('\n')
  return `# ${context.name}\n\n${markdownText(context.description)}\n\n> ${title}\n\n${body}`
}

export const VITE_HTML = (title: string, script: string, body = '<div id="root"></div>'): string =>
  `<!doctype html>\n<html lang="tr">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width,initial-scale=1" />\n    <title>${title}</title>\n  </head>\n  <body>\n    ${body}\n    <script type="module" src="${script}"></script>\n  </body>\n</html>\n`
