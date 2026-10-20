// Ultron yerel hafıza çekirdeği: kayıt doğrulama, benzerlik, çelişki tespiti ve bağlam seçimi.
// Bu modül ağ erişimi yapmaz ve dosya okumaz; yalnızca saf veri işlemleri içerir.
import { randomUUID } from 'node:crypto'
import type { MemoryEntry, MemoryKind, UserMemory } from './shared.ts'

export const memoryLimits = {
  total: 400,
  textLength: 2000,
  tags: 8,
  tagLength: 40,
  similarThreshold: 0.72,
  conflictThreshold: 0.34,
}

export const memoryKinds: MemoryKind[] = ['preference', 'knowledge', 'feedback', 'conversation']

export const memoryKindLabels: Record<MemoryKind, string> = {
  preference: 'Tercih',
  knowledge: 'Bilgi',
  feedback: 'Geri bildirim',
  conversation: 'Konuşma',
}

export function isMemoryKind(value: unknown): value is MemoryKind {
  return typeof value === 'string' && (memoryKinds as string[]).includes(value)
}

export function normalizeMemoryText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
  if (!text) return null
  return text.slice(0, memoryLimits.textLength)
}

export function normalizeMemoryTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const tags: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const tag = item.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, memoryLimits.tagLength)
    if (tag && !tags.includes(tag)) tags.push(tag)
    if (tags.length >= memoryLimits.tags) break
  }
  return tags
}

function normalizeTimestamp(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString()
  return fallback
}

export function sanitizeMemoryEntry(value: unknown, now = new Date().toISOString()): MemoryEntry | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const text = normalizeMemoryText(record.text)
  if (!text || !isMemoryKind(record.kind)) return null
  const id = typeof record.id === 'string' && /^[\w-]{6,80}$/.test(record.id) ? record.id : randomUUID()
  const projectPath = typeof record.projectPath === 'string' && record.projectPath.length <= 500 ? record.projectPath : null
  const source = record.source === 'user' || record.source === 'agent' || record.source === 'feedback' ? record.source : 'user'
  const conflictWith = typeof record.conflictWith === 'string' && /^[\w-]{6,80}$/.test(record.conflictWith) ? record.conflictWith : null
  return {
    id,
    kind: record.kind,
    text,
    tags: normalizeMemoryTags(record.tags),
    projectPath,
    source,
    createdAt: normalizeTimestamp(record.createdAt, now),
    updatedAt: normalizeTimestamp(record.updatedAt, now),
    conflictWith,
  }
}

export function sanitizeUserMemory(value: unknown, now = new Date().toISOString()): UserMemory {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const rawEntries = Array.isArray(record.entries) ? record.entries : []
  const entries: MemoryEntry[] = []
  const seen = new Set<string>()
  for (const item of rawEntries) {
    const entry = sanitizeMemoryEntry(item, now)
    if (!entry || seen.has(entry.id)) continue
    seen.add(entry.id)
    entries.push(entry)
  }
  return { version: 1, entries: trimMemoryEntries(entries) }
}

export function newMemoryEntry(input: {
  kind: MemoryKind
  text: unknown
  tags?: unknown
  projectPath?: string | null
  source?: MemoryEntry['source']
  now?: string
}): MemoryEntry | null {
  const text = normalizeMemoryText(input.text)
  if (!text || !isMemoryKind(input.kind)) return null
  const now = input.now ?? new Date().toISOString()
  const projectPath = typeof input.projectPath === 'string' && input.projectPath.length <= 500 ? input.projectPath : null
  return {
    id: randomUUID(),
    kind: input.kind,
    text,
    tags: normalizeMemoryTags(input.tags),
    projectPath,
    source: input.source ?? 'user',
    createdAt: now,
    updatedAt: now,
    conflictWith: null,
  }
}

export function tokenizeMemory(text: string): string[] {
  const tokens = text
    .toLocaleLowerCase('tr-TR')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2)
  return [...new Set(tokens)]
}

export function memorySimilarity(left: string, right: string): number {
  const a = new Set(tokenizeMemory(left))
  const b = new Set(tokenizeMemory(right))
  if (!a.size || !b.size) return left.trim().toLocaleLowerCase('tr-TR') === right.trim().toLocaleLowerCase('tr-TR') ? 1 : 0
  let shared = 0
  for (const token of a) if (b.has(token)) shared++
  return shared / (a.size + b.size - shared)
}

export function findSimilarEntry(entries: MemoryEntry[], text: string, kind: MemoryKind, projectPath: string | null): MemoryEntry | null {
  let best: MemoryEntry | null = null
  let bestScore = 0
  for (const entry of entries) {
    if (entry.kind !== kind) continue
    if ((entry.projectPath ?? null) !== (projectPath ?? null)) continue
    const score = memorySimilarity(entry.text, text)
    if (score > bestScore) { bestScore = score; best = entry }
  }
  return bestScore >= memoryLimits.similarThreshold ? best : null
}

const negationWords = /(?:^|[^\p{L}\p{N}])(?:değil|yok|asla|hiçbir)(?![\p{L}\p{N}])/iu
const negationStems = /(?:olmasın|kalmasın|kullanma|kullanmayın|istemiyorum|istemem|yasak|kapat|devre dışı|never|don'?t|do not)/iu

function hasNegation(text: string): boolean {
  return negationWords.test(text) || negationStems.test(text)
}

export function memoryConflict(left: MemoryEntry, right: MemoryEntry): boolean {
  if (left.kind !== right.kind) return false
  if ((left.projectPath ?? null) !== (right.projectPath ?? null)) return false
  if (memorySimilarity(left.text, right.text) < memoryLimits.conflictThreshold) return false
  return hasNegation(left.text) !== hasNegation(right.text)
}

const kindBaseScore: Record<MemoryKind, number> = { preference: 0.5, feedback: 0.45, knowledge: 0.2, conversation: 0 }

// Türkçe ekler için basit önek eşleşmesi: "testleri" ↔ "testler" gibi kelimeler örtüşür sayılır.
function overlapCount(tokens: string[], queryTokens: Set<string>): number {
  let overlap = 0
  for (const token of tokens) {
    if (queryTokens.has(token)) { overlap++; continue }
    if (token.length < 5) continue
    const prefix = token.slice(0, 5)
    for (const queryToken of queryTokens) {
      if (queryToken.length >= 5 && (queryToken.startsWith(prefix) || token.startsWith(queryToken.slice(0, 5)))) { overlap++; break }
    }
  }
  return overlap
}

export function selectRelevantMemory(entries: MemoryEntry[], query: string, options: { limit: number; projectPath?: string | null }): MemoryEntry[] {
  const limit = Math.max(1, Math.min(24, Math.floor(options.limit)))
  const currentProject = options.projectPath ?? null
  const queryTokens = new Set(tokenizeMemory(query))
  const now = Date.now()
  const scored = entries.map((entry) => {
    const tokens = tokenizeMemory(entry.text)
    const overlap = overlapCount(tokens, queryTokens)
    const overlapScore = tokens.length ? overlap / Math.sqrt(tokens.length) : 0
    const projectScore = entry.projectPath === null ? 0.1 : entry.projectPath === currentProject ? 0.35 : -0.6
    const ageDays = Math.max(0, (now - Date.parse(entry.updatedAt)) / 86_400_000)
    const recency = Number.isFinite(ageDays) ? Math.max(0, 0.3 - ageDays / 120) : 0
    return { entry, score: overlapScore + kindBaseScore[entry.kind] + projectScore + recency }
  })
  return scored
    .filter((item) => item.score >= 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.entry)
}

export type MemoryMergeAction = 'added' | 'merged' | 'conflict'
export type MemoryMergeResult = { entries: MemoryEntry[]; action: MemoryMergeAction; entry: MemoryEntry; conflictWith: MemoryEntry | null }

export function mergeIntoMemory(entries: MemoryEntry[], candidate: MemoryEntry): MemoryMergeResult {
  const conflicting = entries.find((entry) => memoryConflict(entry, candidate))
  if (conflicting) {
    const conflicted: MemoryEntry = { ...candidate, conflictWith: conflicting.id }
    const updated = entries.map((entry) => entry.id === conflicting.id ? { ...entry, conflictWith: candidate.id } : entry)
    return { entries: trimMemoryEntries([...updated, conflicted]), action: 'conflict', entry: conflicted, conflictWith: conflicting }
  }
  const similar = findSimilarEntry(entries, candidate.text, candidate.kind, candidate.projectPath)
  if (similar) {
    const merged: MemoryEntry = {
      ...similar,
      text: candidate.text,
      tags: [...new Set([...similar.tags, ...candidate.tags])].slice(0, memoryLimits.tags),
      updatedAt: candidate.updatedAt,
      conflictWith: null,
    }
    return { entries: trimMemoryEntries(entries.map((entry) => entry.id === similar.id ? merged : entry)), action: 'merged', entry: merged, conflictWith: null }
  }
  return { entries: trimMemoryEntries([...entries, candidate]), action: 'added', entry: candidate, conflictWith: null }
}

export function updateMemoryEntry(entries: MemoryEntry[], id: string, patch: { text?: unknown; tags?: unknown; kind?: unknown }, now = new Date().toISOString()): MemoryEntry | null {
  const target = entries.find((entry) => entry.id === id)
  if (!target) return null
  const text = patch.text === undefined ? target.text : normalizeMemoryText(patch.text)
  if (!text) return null
  const kind = patch.kind === undefined ? target.kind : isMemoryKind(patch.kind) ? patch.kind : target.kind
  const tags = patch.tags === undefined ? target.tags : normalizeMemoryTags(patch.tags)
  const updated: MemoryEntry = { ...target, text, kind, tags, updatedAt: now }
  const index = entries.indexOf(target)
  entries[index] = updated
  return updated
}

export function removeMemoryEntry(entries: MemoryEntry[], id: string): boolean {
  const index = entries.findIndex((entry) => entry.id === id)
  if (index < 0) return false
  entries.splice(index, 1)
  return true
}

export function forgetMatchingEntries(entries: MemoryEntry[], query: string, max = 5): number {
  if (!query.trim()) return 0
  const victims: MemoryEntry[] = []
  for (const entry of entries) {
    if (victims.length >= max) break
    const contained = entry.text.toLocaleLowerCase('tr-TR').includes(query.toLocaleLowerCase('tr-TR').trim())
    if (contained || memorySimilarity(entry.text, query) >= 0.6) victims.push(entry)
  }
  for (const victim of victims) removeMemoryEntry(entries, victim.id)
  return victims.length
}

export function trimMemoryEntries(entries: MemoryEntry[]): MemoryEntry[] {
  if (entries.length <= memoryLimits.total) return entries
  const kept = [...entries]
  const dropOrder: MemoryKind[] = ['conversation', 'knowledge', 'feedback', 'preference']
  for (const kind of dropOrder) {
    if (kept.length <= memoryLimits.total) break
    const removable = kept
      .filter((entry) => entry.kind === kind)
      .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
    for (const victim of removable) {
      if (kept.length <= memoryLimits.total) break
      removeMemoryEntry(kept, victim.id)
    }
  }
  return kept
}
