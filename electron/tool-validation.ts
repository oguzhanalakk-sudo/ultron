type JsonSchema = {
  type?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: unknown[]
  minItems?: number
  maxItems?: number
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  additionalProperties?: boolean
}
type ToolDefinition = { type?: string; function?: { name?: string; parameters?: JsonSchema } }

function validateValue(value: unknown, schema: JsonSchema, label: string): void {
  const type = schema.type
  const matches = type === 'object' ? Boolean(value && typeof value === 'object' && !Array.isArray(value))
    : type === 'array' ? Array.isArray(value)
      : type === 'string' ? typeof value === 'string'
        : type === 'integer' ? Number.isInteger(value)
          : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
            : type === 'boolean' ? typeof value === 'boolean' : true
  if (!matches) throw new Error(`Araç parametresi "${label}" ${type ?? 'geçerli'} türünde olmalı.`)
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`Araç parametresi "${label}" izin verilen değerlerden biri değil.`)
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) throw new Error(`Araç parametresi "${label}" çok kısa.`)
    if (schema.maxLength !== undefined && value.length > schema.maxLength) throw new Error(`Araç parametresi "${label}" çok uzun.`)
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) throw new Error(`Araç parametresi "${label}" alt sınırın altında.`)
    if (schema.maximum !== undefined && value > schema.maximum) throw new Error(`Araç parametresi "${label}" üst sınırı aşıyor.`)
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) throw new Error(`Araç parametresi "${label}" yeterli öğe içermiyor.`)
    if (schema.maxItems !== undefined && value.length > schema.maxItems) throw new Error(`Araç parametresi "${label}" çok fazla öğe içeriyor.`)
    if (schema.items) value.forEach((item, index) => validateValue(item, schema.items!, `${label}[${index}]`))
  }
  if (type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as Record<string, unknown>
    const properties = schema.properties ?? {}
    for (const key of schema.required ?? []) if (!(key in object)) throw new Error(`Araç parametresi "${label}.${key}" gerekli.`)
    for (const key of Object.keys(object)) {
      if (!(key in properties)) {
        if (schema.additionalProperties === true) continue
        throw new Error(`Araç parametresi "${label}.${key}" tanınmıyor.`)
      }
      validateValue(object[key], properties[key], `${label}.${key}`)
    }
  }
}

export function validateToolArguments(name: string, rawArgs: string, tools: unknown[]): Record<string, unknown> {
  if (typeof rawArgs !== 'string' || rawArgs.length > 600_000) throw new Error(`Model ${name} aracına geçersiz veya aşırı büyük parametre verdi.`)
  const definition = tools.find((tool) => (tool as ToolDefinition | null)?.function?.name === name) as ToolDefinition | undefined
  if (!definition?.function?.parameters) throw new Error(`Bilinmeyen araç: ${name}`)
  let value: unknown
  try { value = JSON.parse(rawArgs || '{}') } catch { throw new Error(`Model ${name} aracına geçersiz JSON verdi.`) }
  validateValue(value, definition.function.parameters, name)
  return value as Record<string, unknown>
}
