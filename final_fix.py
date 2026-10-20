# Fix script for main.ts - applies all Codex-level fixes
import re

with open(r'C:\Users\user\Desktop\codexx\electron\main.ts', 'r', encoding='utf-8') as f:
    content = f.read()

print("Applying all fixes...")

# 1. Fix emptyMemory call
content = content.replace('memory: emptyMemory(),', 'memory: emptyMemory,')
print("Fixed emptyMemory call")

# 2. Add open_url tool definition after open_file
marker = "name: 'open_file',"
idx = content.find(marker)
if idx != -1:
    # Find the matching '},' that closes the open_file tool
    brace_count = 0
    for i in range(idx, min(idx + 500, len(content))):
        if content[i] == '{':
            pass
        if content[i:i+2] == '},':
            # Check if this is the closing of open_file tool
            substring = content[idx:i+2]
            open_braces = substring.count('{')
            close_braces = substring.count('}')
            if open_braces == close_braces:
                tool_def = """

  { type: 'function', function: { name: 'open_url', description: 'Bir web adresini (http/https) sistem varsayılan tarayıcısında açar. Sadece http: ve https: protokollerine izin verilir. Yerel dosya veya özel protokoller (file:, ftp:, vb.) desteklenmez.', parameters: { type: 'object', properties: { url: { type: 'string', maxLength: 2048, description: 'Açılacak web adresi (örn. https://google.com)' } }, required: ['url'] } } },"""
                content = content[:i+2] + tool_def + content[i+2:]
                print("Added open_url tool definition")
                break

# 2. Add open_url case handler before list_files
case_marker = "case 'list_files': {"
idx = content.find(case_marker)
if idx != -1:
    case_handler = """

    case 'open_url': {
      const url = String(args.url ?? '').trim()
      if (!url) throw new Error('url parametresi gerekli')
      try {
        const parsed = new URL(url)
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          throw new Error('Sadece http: ve https: protokollerine izin verilir')
        }
      } catch {
        throw new Error('Geçersiz URL formatı')
      }
      await shell.openExternal(url)
      activity('success', 'URL tarayıcıda açıldı', url, { tool: 'open_url', operation: 'url-open', target: url, result: 'success' })
      return JSON.stringify({ ok: true, url, message: 'URL sistem varsayılan tarayıcısında açıldı.' })
    }

"""
    content = content[:idx] + "\n    case 'open_url': {\n      const url = String(args.url ?? '').trim()\n      if (!url) throw new Error('url parametresi gerekli')\n      try {\n        const parsed = new URL(url)\n        if (!['http:', 'https:'].includes(parsed.protocol)) {\n          throw new Error('Sadece http: ve https: protokollerine izin verilir')\n        }\n      } catch {\n        throw new Error('Geçersiz URL formatı')\n      }\n      await shell.openExternal(url)\n      activity('success', 'URL tarayıcıda açıldı', url, { tool: 'open_url', operation: 'url-open', target: url, result: 'success' })\n      return JSON.stringify({ ok: true, url, message: 'URL sistem varsayılan tarayıcısında açıldı.' })\n    }\n\n" + content[idx:]
    print("Added open_url case handler")

# 3. Add generateAutoPlan function before makeTaskPlan
marker = 'async function makeTaskPlan(args: Record<string, unknown>) {'
idx = content.find(marker)
if idx != -1:
    new_func = '''

  // ===== AUTO-PLANNING HELPER: Model ile otonom plan oluştur =====
  async function generateAutoPlan(request: string, tools: typeof agentTools, chain: Record<string, unknown>[], signal: AbortSignal, taskId: string): Promise<{ ok: boolean; plan?: any }> {
    const systemPrompt = `${buildAgentSystemPrompt({ project: currentProject(), taskId, request, editMode: 'review', commandMode: 'confirm', resourceRoots: [], memory: emptyMemory, previousTask: null, resumeInstructions: '', userMemory: [], solutionHints: '' })}`

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

"""
    idx = content.find('async function makeTaskPlan(args: Record<string, unknown>) {')
    if idx != -1:
        content = content[:idx] + new_func + content[idx:]
        print("Added generateAutoPlan function")

# 2. Fix auto-planning section in runAgent
old_auto = '''    const workspace = await readWorkspace()

    // ===== AUTO-PLANNING: Otomatik plan oluşturma (çok adımlı görevler için) =====
    if (!resumeTaskId && !restorePlan.steps.length) {
      const needsPlanning = requiresFileOperationForRequest || requiresReadOperationForRequest ||
        /\\b(yap|olu\\u015ftur|ekle|d\\u00fczenle|refactor|test|debug|analiz|optimize|migrate|implement)\\b/i.test(latestUserMessage)
      if (needsPlanning) {
        const planResult = await makeTaskPlan({
          title: `Otonom Plan: ${latestUserMessage.slice(0, 80)}`,
          objective: latestUserMessage,
          steps: [
            'Proje yap\\u0131s\\u0131n\\u0131 ve ilgili dosyalar\\u0131 incele',
            'Gereksinimleri analiz et ve teknik plan olu\\u015ftur',
            'Kod de\\u011fi\\u015fikliklerini uygula',
            'Testleri \\u00e7al\\u0131\u015ft\\u0131r ve do\\u011frula',
            'Sonu\\u00e7lar\\u0131 \\u00f6zetle ve raporla'
          ],
          tests: []
        }, activeTools, chain, controller.signal)
        if (planResult.ok) {
          activity('tool', 'Otonom plan olu\\u015fturuldu', planResult.plan.title, { taskId: journalTask.id })
        }
      }
    }
    const resumeInstructions = resumeTaskId ? `Önceki görev kaydı: ${JSON.stringify({ request: journalTask.request, plan: journalTask.plan, completedSteps: journalTask.completedSteps, pendingSteps: journalTask.pendingSteps, acceptanceTests: journalTask.acceptanceTests, pendingChecks: verification.pending.map((item) => ({ tool: item.tool, status: item.status, message: item.analysis.message })), recentEvents: journalTask.events.slice(-20), errors: journalTask.errors })}. Göreve devam etmeden önce mevcut dosyaları ve araç kapsamlarını yeniden incele; eski araç çıktılarını veya önceki onayları güncel gerçek kabul etme. Her yeni işlem için PermissionManager mevcut izinleri tekrar denetler.` : ''
    const system = buildAgentSystemPrompt({ project: currentProject(), taskId: journalTask.id, request: latestUserMessage, editMode: workspace.permissions.editMode, commandMode: workspace.permissions.commandMode, resourceRoots: workspace.resourceRoots, memory: workspace.memory, previousTask: workspace.task, resumeInstructions, userMemory: selectRelevantMemory(userMemory.entries, latestUserMessage, { limit: 6, projectPath: currentProject() }), solutionHints: await loadSolutionMemoryHints(latestUserMessage) })
    const chain: Record<string, unknown>[] = [{ role: 'system', content: `${system} Yürütme bütçesi: en fazla ${orchestrator.limits.maxModelTurns} model turu; yanıt başına ${orchestrator.limits.maxToolCallsPerTurn}, görev başına ${orchestrator.limits.maxToolCalls} araç çağrısı; hata düzeltme denemesi ${orchestrator.limits.maxCorrectionAttempts}. Aynı başarısız çağrıyı yineleme. Açık plan adımlarını doğrulamadan tamamlandı ilan etme.` }, ...trimConversationContext(messages).map((message) => ({ role: message.role, content: message.content })))
    const readFiles = new Set<string>()
    const requiresFileOperationForRequest = requiresFileOperation(latestUserMessage)
    const requiresReadOperationForRequest = requiresReadOperation(latestUserMessage)
    let requiredToolRetry = false
    let requiredReadRetry = false
    let fileChangeToolUsed = false
    let readFileToolUsed = false
    let blockedReason: string | null = null"""

new_auto = """    const workspace = await readWorkspace()

    // Variable declarations moved up for auto-planning
    const requiresFileOperationForRequest = requiresFileOperation(latestUserMessage)
    const requiresReadOperationForRequest = requiresReadOperation(latestUserMessage)

    // ===== AUTO-PLANNING: Otomatik plan oluşturma (çok adımlı görevler için) =====
    if (!resumeTaskId && !restorePlan.steps.length) {
      const needsPlanning = requiresFileOperationForRequest || requiresReadOperationForRequest ||
        /\\b(yap|olu\\u015ftur|ekle|d\\u00fczenle|refactor|test|debug|analiz|optimize|migrate|implement|geli\\u015ftir|kodla)\\b/i.test(latestUserMessage)
      if (needsPlanning) {
        const autoPlan = await generateAutoPlan(latestUserMessage, activeTools, [], controller.signal, journalTask.id)
        if (autoPlan.ok && autoPlan.plan) {
          await makeTaskPlan(autoPlan.plan)
          activity('tool', 'Otonom plan olu\\u015fturuldu', autoPlan.plan.title, { taskId: journalTask.id })
        }
      }
    }
    const resumeInstructions = resumeTaskId ? `Önceki görev kaydı: ${JSON.stringify({ request: journalTask.request, plan: journalTask.plan, completedSteps: journalTask.completedSteps, pendingSteps: journalTask.pendingSteps, acceptanceTests: journalTask.acceptanceTests, pendingChecks: verification.pending.map((item) => ({ tool: item.tool, status: item.status, message: item.analysis.message })), recentEvents: journalTask.events.slice(-20), errors: journalTask.errors })}. Göreve devam etmeden önce mevcut dosyaları ve araç kapsamlarını yeniden incele; eski araç çıktılarını veya önceki onayları güncel gerçek kabul etme. Her yeni işlem için PermissionManager mevcut izinleri tekrar denetler.` : ''
    const system = buildAgentSystemPrompt({ project: currentProject(), taskId: journalTask.id, request: latestUserMessage, editMode: workspace.permissions.editMode, commandMode: workspace.permissions.commandMode, resourceRoots: workspace.resourceRoots, memory: workspace.memory, previousTask: workspace.task, resumeInstructions, userMemory: selectRelevantMemory(userMemory.entries, latestUserMessage, { limit: 6, projectPath: currentProject() }), solutionHints: await loadSolutionMemoryHints(latestUserMessage) })
    const chain: Record<string, unknown>[] = [{ role: 'system', content: `${system} Yürütme bütçesi: en fazla ${orchestrator.limits.maxModelTurns} model turu; yanıt başına ${orchestrator.limits.maxToolCallsPerTurn}, görev başına ${orchestrator.limits.maxToolCalls} araç çağrısı; hata düzeltme denemesi ${orchestrator.limits.maxCorrectionAttempts}. Aynı başarısız çağrıyı yineleme. Açık plan adımlarını doğrulamadan tamamlandı ilan etme.` }, ...trimConversationContext(messages).map((message) => ({ role: message.role, content: message.content })))
    const readFiles = new Set<string>()
    let requiredToolRetry = false
    let requiredReadRetry = false
    let fileChangeToolUsed = false
    let readFileToolUsed = false
    let blockedReason: string | null = null"""

content = content.replace(old_auto, new_auto)
print("Fixed auto-planning section")

# Fix 3: Fix otonom completion logic
old_no_tools = '''      if (!result.toolCalls.length) {
        // Check if task is truly complete (has plan, all steps done, tests passing)
        const latestRecord = await taskStore().get(journalTask.id)
        const hasPlan = latestRecord?.plan?.length > 0
        const pendingSteps = latestRecord?.pendingSteps?.length ?? 0
        const hasFailedChecks = verification.pending.some((item) => item.status !== 'stale')
        const missingAcceptance = (latestRecord?.acceptanceTests ?? []).filter((command) => !verification.hasAcceptance(command))
        const isTrulyComplete = !hasPlan || (pendingSteps === 0 && !hasFailedChecks && missingAcceptance.length === 0)

        if (!isTrulyComplete) {
          // Task not complete - force continuation
          chain.push({ role: 'system', content: 'Görev henüz tamamlanmadı. Açık plan adımları, başarısız kontroller veya eksik kabul testleri var. Devam et: plan adımını güncelle, araç çağır, testleri tekrar çalıştır.' })
          continue
        }

        if (requiresFileOperationForRequest && !requiredToolRetry && !fileChangeToolUsed) {
          requiredToolRetry = true
          activity('status', 'Kod değişikliği için araç çağrısı tekrar isteniyor')
          chain.push({ role: 'system', content: 'ZORUNLU: Kullanıcı seçili proje dosyalarında gerçek bir kod değişikliği istedi. Sohbet içinde kod bloğu yazıp bitirme. Önce read_file ile mevcut dosyayı oku; sonra write_file veya apply_patch aracını çağırıp gerçek değişiklik taslağını oluştur. Kullanıcı taslak/inceleme istediyse apply_patch önerisi olarak bırak; otomatik uygula izni varsa yedekli aracı kullan. Araç çağrısı yapamıyorsan kod uydurmak yerine açıkça bu sınırlamayı bildir.' })
          continue
        }
        if (requiresReadOperationForRequest && !requiredReadRetry && !readFileToolUsed) {
          requiredReadRetry = true
          activity('status', 'Dosya okuma için gerçek read_file kanıtı isteniyor')
          chain.push({ role: 'system', content: 'ZORUNLU: Kullanıcı gerçek bir dosyanın içeriğini görmek/özetlemek istiyor. Bellekten içerik UYDURMA; önce read_file ile dosyayı oku ve özeti yalnızca gerçek içerikten çıkar. Dosya kapsam içinde bulunamıyorsa (yol kapsamda değilse) bu sınırlamayı açıkça bildir; içerik tahmini yazma.' })
          continue
        }
        const modelMessage = requiredReadRetry && requiresReadOperationForRequest && !readFileToolUsed && !chain.slice(-3).some((entry) => Array.isArray(entry.tool_calls))
          ? 'İstenen dosya içeriğini gerçek read_file çağrısı olmadan doğrulayamadım; model bellekten içerik üretti. Dosyanın proje yetkisi veya kaynak kapsamı içinde olduğundan emin olup tekrar deneyin.'
          : requiredToolRetry && requiresFileOperationForRequest && !chain.slice(-3).some((entry) => Array.isArray(entry.tool_calls))
            ? 'İstenen kod değişikliğini gerçek dosya aracıyla hazırlayamadım; model bu denemede araç çağrısı üretmedi. Modelin araç çağrısı desteğini ve proje izinlerini kontrol edip tekrar deneyin.'
            : result.content
        await updateAgentProgress('finalizing', orchestrator.snapshot, journalTask.id)
        const finalSource = await captureVerificationSource()
        invalidateMutatedEvidence()
        verification.invalidate(finalSource)
        verificationRequired ||= activeTaskFilesChanged || Boolean(initialSource && finalSource && initialSource !== finalSource)
        await saveVerification()"""

new_no_tools = """      if (!result.toolCalls.length) {
        // Check if task is truly complete (has plan, all steps done, tests passing)
        const latestRecord = await taskStore().get(journalTask.id)
        const hasPlan = latestRecord?.plan?.length > 0
        const pendingSteps = latestRecord?.pendingSteps?.length ?? 0
        const hasFailedChecks = verification.pending.some((item) => item.status !== 'stale')
        const missingAcceptance = (latestRecord?.acceptanceTests ?? []).filter((command) => !verification.hasAcceptance(command))
        const isTrulyComplete = !hasPlan || (pendingSteps === 0 && !hasFailedChecks && missingAcceptance.length === 0)

        if (!isTrulyComplete) {
          // Task not complete - force continuation
          chain.push({ role: 'system', content: 'Görev henüz tamamlanmadı. Açık plan adımları, başarısız kontroller veya eksik kabul testleri var. Devam et: plan adımını güncelle, araç çağır, testleri tekrar çalıştır.' })
          continue
        }

        if (requiresFileOperationForRequest && !requiredToolRetry && !fileChangeToolUsed) {
          requiredToolRetry = true
          activity('status', 'Kod değişikliği için araç çağrısı tekrar isteniyor')
          chain.push({ role: 'system', content: 'ZORUNLU: Kullanıcı seçili proje dosyalarında gerçek bir kod değişikliği istedi. Sohbet içinde kod bloğu yazıp bitirme. Önce read_file ile mevcut dosyayı oku; sonra write_file veya apply_patch aracını çağırıp gerçek değişiklik taslağını oluştur. Kullanıcı taslak/inceleme istediyse apply_patch önerisi olarak bırak; otomatik uygula izni varsa yedekli aracı kullan. Araç çağrısı yapamıyorsan kod uydurmak yerine açıkça bu sınırlamayı bildir.' })
          continue
        }
        if (requiresReadOperationForRequest && !requiredReadRetry && !readFileToolUsed) {
          requiredReadRetry = true
          activity('status', 'Dosya okuma için gerçek read_file kanıtı isteniyor')
          chain.push({ role: 'system', content: 'ZORUNLU: Kullanıcı gerçek bir dosyanın içeriğini görmek/özetlemek istiyor. Bellekten içerik UYDURMA; önce read_file ile dosyayı oku ve özeti yalnızca gerçek içerikten çıkar. Dosya kapsam içinde bulunamıyorsa (yol kapsamda değilse) bu sınırlamayı açıkça bildir; içerik tahmini yazma.' })
          continue
        }
        const modelMessage = requiredReadRetry && requiresReadOperationForRequest && !readFileToolUsed && !chain.slice(-3).some((entry) => Array.isArray(entry.tool_calls))
          ? 'İstenen dosya içeriğini gerçek read_file çağrısı olmadan doğrulayamadım; model bellekten içerik üretti. Dosyanın proje yetkisi veya kaynak kapsamı içinde olduğundan emin olup tekrar deneyin.'
          : requiredToolRetry && requiresFileOperationForRequest && !chain.slice(-3).some((entry) => Array.isArray(entry.tool_calls))
            ? 'İstenen kod değişikliğini gerçek dosya aracıyla hazırlayamadım; model bu denemede araç çağrısı üretmedi. Modelin araç çağrısı desteğini ve proje izinlerini kontrol edip tekrar deneyin.'
            : result.content
        await updateAgentProgress('finalizing', orchestrator.snapshot, journalTask.id)
        const finalSource = await captureVerificationSource()
        invalidateMutatedEvidence()
        verification.invalidate(finalSource)
        verificationRequired ||= activeTaskFilesChanged || Boolean(initialSource && finalSource && initialSource !== finalSource)
        await saveVerification()"""

content = content.replace(old_no_tools, new_no_tools)
print("Fixed otonom completion logic")

# Fix 4: Fix emptyMemory() call in generateAutoPlan
content = content.replace('memory: emptyMemory(),', 'memory: emptyMemory,')
print("Fixed emptyMemory call in generateAutoPlan")

# Write the fixed file
with open(r'C:\Users\user\Desktop\codexx\electron\main.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print("All fixes applied!")