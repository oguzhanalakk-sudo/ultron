import re

with open(r'C:\Users\user\Desktop\codexx\electron\main.ts', 'r', encoding='utf-8') as f:
    c = f.read()

# ============================================================
# FIX 1: Fix generateAutoPlan function - fix emptyMemory() call
# ============================================================
c = c.replace(
    'memory: emptyMemory(),',
    'memory: emptyMemory,'
)

# ============================================================
# FIX 2: Fix auto-planning section in runAgent
# Move variable declarations before auto-planning section
# ============================================================
old_auto_plan = '''    const workspace = await readWorkspace()

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
    let blockedReason: string | null = null'''

new_auto_plan = '''    const workspace = await readWorkspace()

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
    let blockedReason: string | null = null'''

c = c.replace(old_auto_plan, new_auto_plan)

# ============================================================
# FIX 3: Fix the "no tool calls" section to check task completion properly
# ============================================================
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
        await saveVerification()'''

new_no_tools = '''      if (!result.toolCalls.length) {
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
        await saveVerification()'''

c = c.replace(old_no_tools, new_no_tools)

# ============================================================
# FIX 4: Fix duplicate variable declarations later in the function
# ============================================================
# Remove duplicate declarations that appear later in the function
c = c.replace(
    '''        const latestRecord = await taskStore().get(journalTask.id)
        const couldNotUseRequiredFileTool = (requiredToolRetry && requiresFileOperationForRequest && !fileChangeToolUsed) || (requiredReadRetry && requiresReadOperationForRequest && !readFileToolUsed)
        const hasUnverifiedSteps = Boolean(latestRecord?.plan.length && latestRecord.pendingSteps.length)
        const failedChecks = verification.pending.filter((item) => item.status !== 'stale')
        const missingAcceptance = (latestRecord?.acceptanceTests ?? []).filter((command) => !verification.hasAcceptance(command))''',
    '''        const latestRecord = await taskStore().get(journalTask.id)
        const couldNotUseRequiredFileTool = (requiredToolRetry && requiresFileOperationForRequest && !fileChangeToolUsed) || (requiredReadRetry && requiresReadOperationForRequest && !readFileToolUsed)
        const hasUnverifiedSteps = Boolean(latestRecord?.plan?.length && latestRecord.pendingSteps?.length)
        const failedChecks = verification.pending.filter((item) => item.status !== 'stale')
        const missingAcceptance = (latestRecord?.acceptanceTests ?? []).filter((command) => !verification.hasAcceptance(command))'''
)

# ============================================================
# FIX 5: Fix emptyMemory() call in generateAutoPlan
# ============================================================
c = c.replace(
    'memory: emptyMemory(),',
    'memory: emptyMemory,'
)

# Write the fixed file
with open(r'C:\Users\user\Desktop\codexx\electron\main.ts', 'w', encoding='utf-8') as f:
    f.write(c)

print("All fixes applied!")