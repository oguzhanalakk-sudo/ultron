with open(r'C:\Users\user\Desktop\codexx\electron\main.ts', 'r', encoding='utf-8') as f:
    c = f.read()

# Add generateAutoPlan function before makeTaskPlan
new_func = '''

  // ===== AUTO-PLANNING HELPER: Model ile otonom plan oluştur =====
  async function generateAutoPlan(request: string, tools: typeof agentTools, chain: Record<string, unknown>[], signal: AbortSignal, taskId: string): Promise<{ ok: boolean; plan?: any }> {
    const systemPrompt = `${buildAgentSystemPrompt({ project: currentProject(), taskId, request, editMode: 'review', commandMode: 'confirm', resourceRoots: [], memory: emptyMemory(), previousTask: null, resumeInstructions: '', userMemory: [], solutionHints: '' })}

ROL: Planlama uzmanı. Kullanıcı isteğini analiz et, küçük, test edilebilir adımlara böl. Her adım için açık başlık ve ölçülebilir kriter ver. tests alanına run_tests komutları ekle. Sadece JSON döndür.`
    const userPrompt = `Kullanıcı isteği: "${request}"

JSON formatında plan üret:
{
  "title": "Plan başlığı",
  "objective": "Hedef açıklaması",
  "steps": ["Adım 1", "Adım 2", "Adım 3"],
  "tests": ["run_tests komutu 1", "run_tests komutu 2"]
}
Sadece JSON, açıklama yok.`

    try {
      const messages: Record<string, unknown>[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
      const result = await streamCompletion(messages, signal, tools.filter(t => ['list_files', 'read_file', 'search_code', 'project_info'].includes(t.function.name)))
      if (result.toolCalls.length) return { ok: false }
      const content = result.content.trim()
      const jsonMatch = content.match(/\\{[\s\S]*\\}/)
      if (!jsonMatch) return { ok: false }
      const plan = JSON.parse(jsonMatch[0])
      if (!plan.title || !plan.objective || !Array.isArray(plan.steps) || !plan.steps.length) return { ok: false }
      return { ok: true, plan }
    } catch {
      return { ok: false }
    }
  }

'''

# Insert before makeTaskPlan
marker = 'async function makeTaskPlan(args: Record<string, unknown>) {'
idx = c.find(marker)
if idx != -1:
    c = c[:idx] + new_func + c[idx:]
    print("Added generateAutoPlan function")
else:
    print("ERROR: Could not find makeTaskPlan marker")

with open(r'C:\Users\user\Desktop\codexx\electron\main.ts', 'w', encoding='utf-8') as f:
    f.write(c)

print("Done!")