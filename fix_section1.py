with open(r'C:\Users\user\Desktop\codexx\electron\main.ts', 'r', encoding='utf-8') as f:
    c = f.read()

# Fix 1: Fix the auto-planning section - move variable declarations up
old_section = '''await recordTaskEvent({ type: 'result', name: resumeTaskId ? 'task-resumed' : 'task-started', detail: resumeTaskId ? 'Dosya durumu ve izinler araç çağrısı öncesinde yeniden doğrulanacak.' : 'Yeni görev kaydı oluşturuldu.' }, journalTask.id)
    await publishTaskHistory()
    const workspace = await readWorkspace()

    // ===== AUTO-PLANNING: Otomatik plan oluşturma (çok adımlı görevler için) =====
    if (!resumeTaskId && !restorePlan.steps.length) {
      const needsPlanning = requiresFileOperationForRequest || requiresReadOperationForRequest ||
        /\b(yap|oluştur|ekle|düzenle|refactor|test|debug|analiz|optimize|migrate|implement)\b/i.test(latestUserMessage)
      if (needsPlanning) {
        const planResult = await makeTaskPlan({
          title: `Otonom Plan: ${latestUserMessage.slice(0, 80)}`,
          objective: latestUserMessage,
          steps: [
            'Proje yapısını ve ilgili dosyaları incele',
            'Gereksinimleri analiz et ve teknik plan oluştur',
            'Kod değişikliklerini uygula',
            'Testleri çalıştır ve doğrula',
            'Sonuçları özetle ve raporla'
          ],
          tests: []
        }, activeTools, chain, controller.signal)
        if (planResult.ok) {
          activity('tool', 'Otonom plan oluşturuldu', planResult.plan.title, { taskId: journalTask.id })
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
    let blockedReason: string | null = null'''

new_section = '''await recordTaskEvent({ type: 'result', name: resumeTaskId ? 'task-resumed' : 'task-started', detail: resumeTaskId ? 'Dosya durumu ve izinler araç çağrısı öncesinde yeniden doğrulanacak.' : 'Yeni görev kaydı oluşturuldu.' }, journalTask.id)
    await publishTaskHistory()
    const workspace = await readWorkspace()

    // Variable declarations moved up for auto-planning
    const requiresFileOperationForRequest = requiresFileOperation(latestUserMessage)
    const requiresReadOperationForRequest = requiresReadOperation(latestUserMessage)

    // ===== AUTO-PLANNING: Otomatik plan oluşturma (çok adımlı görevler için) =====
    if (!resumeTaskId && !restorePlan.steps.length) {
      const needsPlanning = requiresFileOperationForRequest || requiresReadOperationForRequest ||
        /\\b(yap|oluştur|ekle|düzenle|refactor|test|debug|analiz|optimize|migrate|implement|geliştir|kodla)\\b/i.test(latestUserMessage)
      if (needsPlanning) {
        const autoPlan = await generateAutoPlan(latestUserMessage, activeTools, [], controller.signal, journalTask.id)
        if (autoPlan.ok && autoPlan.plan) {
          await makeTaskPlan(autoPlan.plan)
          activity('tool', 'Otonom plan oluşturuldu', autoPlan.plan.title, { taskId: journalTask.id })
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
    let blockedReason: string | null = null'''

if old_section in c:
    c = c.replace(old_section, new_section)
    print("Fixed auto-planning section")
else:
    print("ERROR: Could not find section to replace")

with open(r'C:\Users\user\Desktop\codexx\electron\main.ts', 'w', encoding='utf-8') as f:
    f.write(c)

print("Done section 1")