export type MemoryRecordKind = 'episodic' | 'semantic' | 'procedural'

export type MemoryItem = {
  id: string
  kind: MemoryRecordKind
  tag: string
  summary: string
  source: string
  confidence: number
  createdAt: string
}

/** Short-lived agent memory for the current runtime; persistent user memory stays in memory-store.ts. */
export class AgentMemoryStore {
  private items: MemoryItem[] = []

  constructor(initial: MemoryItem[] = []) {
    this.items = structuredClone(initial).slice(-300)
  }

  all(): MemoryItem[] {
    return structuredClone(this.items)
  }

  upsert(item: MemoryItem): MemoryItem {
    const normalized: MemoryItem = {
      ...item,
      tag: String(item.tag ?? '').slice(0, 100),
      summary: String(item.summary ?? '').slice(0, 600),
      source: String(item.source ?? '').slice(0, 200),
      confidence: Math.max(0, Math.min(1, Number.isFinite(item.confidence) ? item.confidence : 0)),
    }
    const existingIndex = this.items.findIndex((entry) => entry.id === normalized.id)
    if (existingIndex >= 0) {
      this.items[existingIndex] = normalized
    } else {
      this.items = [...this.items, normalized].slice(-300)
    }
    return structuredClone(normalized)
  }

  remember(kind: MemoryRecordKind, tag: string, summary: string, source: string, confidence = 0.7): MemoryItem {
    const item: MemoryItem = {
      id: this.makeId(),
      kind,
      tag: String(tag ?? '').slice(0, 100),
      summary: String(summary ?? '').slice(0, 600),
      source: String(source ?? '').slice(0, 200),
      confidence: Math.max(0, Math.min(1, Number.isFinite(confidence) ? confidence : 0)),
      createdAt: new Date().toISOString(),
    }
    return this.upsert(item)
  }

  recall(query: string, limit = 10): MemoryItem[] {
    const q = String(query ?? '').trim().toLocaleLowerCase('tr-TR')
    if (!q) return []
    const safeLimit = Math.max(0, Math.min(300, Math.floor(Number.isFinite(limit) ? limit : 10)))
    return this.items
      .filter((item) => `${item.tag} ${item.summary} ${item.source}`.toLocaleLowerCase('tr-TR').includes(q))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, safeLimit)
      .map((item) => structuredClone(item))
  }

  recallByTag(tag: string, limit = 10): MemoryItem[] {
    const normalizedTag = String(tag ?? '').trim().toLocaleLowerCase('tr-TR')
    if (!normalizedTag) return []
    const safeLimit = Math.max(0, Math.min(300, Math.floor(Number.isFinite(limit) ? limit : 10)))
    return this.items
      .filter((item) => item.tag.toLocaleLowerCase('tr-TR') === normalizedTag)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, safeLimit)
      .map((item) => structuredClone(item))
  }

  private makeId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID()
    }
    return `mem-${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
}
