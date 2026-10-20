// Güvenli, eval içermeyen küçük şablon motoru. Desteklenenler:
//   {{anahtar}}  {{a.b}}  {{#if anahtar}}...{{else}}...{{/if}}  {{#each liste}}...{{this}}...{{/each}}
// Kullanıcı verisi hiçbir zaman kod olarak çalıştırılmaz; fonksiyon değerleri yok sayılır.

type Scope = Record<string, unknown>

const MAX_DEPTH = 8
const MAX_ITERATIONS = 1000
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype'])

function lookup(scope: Scope, key: string): unknown {
  if (key === 'this') return scope.this
  let current: unknown = scope
  for (const part of key.split('.')) {
    if (FORBIDDEN.has(part) || current === null || typeof current !== 'object') return undefined
    if (!Object.prototype.hasOwnProperty.call(current, part)) return undefined
    current = (current as Scope)[part]
  }
  return typeof current === 'function' ? undefined : current
}

function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  return Boolean(value)
}

function stringify(value: unknown): string {
  if (value === undefined || value === null || typeof value === 'function') return ''
  if (typeof value === 'object') return ''
  return String(value)
}

function findClose(source: string, start: number, open: string, close: string): { bodyEnd: number; end: number } {
  let depth = 1
  const pattern = new RegExp(`\\{\\{(?:#${open}\\s+[^}]*|/${close})\\}\\}`, 'g')
  pattern.lastIndex = start
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    depth += match[0].startsWith('{{/') ? -1 : 1
    if (depth === 0) return { bodyEnd: match.index, end: pattern.lastIndex }
  }
  throw new Error(`Şablonda kapatılmamış {{#${open}}} bloğu var.`)
}

/** Yalnızca en dış düzeydeki {{else}} konumunu döner (iç içe bloklardakiler sayılmaz). */
function topLevelElse(body: string): number {
  let depth = 0
  const tags = /\{\{(#(?:if|each)\s+[^}]*|\/(?:if|each)|else)\}\}/g
  for (let match = tags.exec(body); match; match = tags.exec(body)) {
    if (match[1].startsWith('#')) depth += 1
    else if (match[1].startsWith('/')) depth -= 1
    else if (depth === 0) return match.index
  }
  return -1
}

export function renderTemplateString(source: string, data: Scope, depth = 0): string {
  if (depth > MAX_DEPTH) throw new Error('Şablon blokları çok derin iç içe.')
  let output = ''
  let cursor = 0
  const tag = /\{\{\s*(?:#(if|each)\s+([\w.]+)|(\w[\w.]*|this))\s*\}\}/g
  for (let match = tag.exec(source); match; match = tag.exec(source)) {
    output += source.slice(cursor, match.index)
    if (match[1]) {
      const kind = match[1]
      const { bodyEnd, end } = findClose(source, tag.lastIndex, kind, kind)
      const body = source.slice(tag.lastIndex, bodyEnd)
      const value = lookup(data, match[2])
      if (kind === 'if') {
        const elseAt = topLevelElse(body)
        const thenPart = elseAt >= 0 ? body.slice(0, elseAt) : body
        const elsePart = elseAt >= 0 ? body.slice(elseAt + '{{else}}'.length) : ''
        output += renderTemplateString(truthy(value) ? thenPart : elsePart, data, depth + 1)
      } else if (Array.isArray(value)) {
        for (const item of value.slice(0, MAX_ITERATIONS)) {
          const scope: Scope = { ...data, this: item, ...(item && typeof item === 'object' && !Array.isArray(item) ? (item as Scope) : {}) }
          output += renderTemplateString(body, scope, depth + 1)
        }
      }
      tag.lastIndex = end
      cursor = end
    } else {
      output += stringify(lookup(data, match[3]))
      cursor = tag.lastIndex
    }
  }
  return output + source.slice(cursor)
}
