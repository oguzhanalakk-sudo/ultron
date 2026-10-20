with open(r'C:\Users\user\Desktop\codexx\electron\main.ts', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find the lines to fix
# Lines 3924-3956 (0-indexed: 3923-3955)
# Need to:
# 1. Move variable declarations before auto-planning section
# 2. Fix the makeTaskPlan call to use generateAutoPlan
# 3. Fix the variable order

new_lines = []
i = 0
while i < len(lines):
    line = lines[i]
    
    # Find the section after "const workspace = await readWorkspace()"
    if 'const workspace = await readWorkspace()' in line and i > 3920:
        new_lines.append(line)
        i += 1
        # Insert variable declarations right after workspace
        new_lines.append('    // Variable declarations moved up for auto-planning\n')
        new_lines.append('    const requiresFileOperationForRequest = requiresFileOperation(latestUserMessage)\n')
        new_lines.append('    const requiresReadOperationForRequest = requiresReadOperation(latestUserMessage)\n')
        new_lines.append('\n')
        new_lines.append('    // ===== AUTO-PLANNING: Otomatik plan oluşturma (çok adımlı görevler için) =====\n')
        new_lines.append('    if (!resumeTaskId && !restorePlan.steps.length) {\n')
        new_lines.append('      const needsPlanning = requiresFileOperationForRequest || requiresReadOperationForRequest ||\n')
        new_lines.append('        /\\\\b(yap|oluştur|ekle|düzenle|refactor|test|debug|analiz|optimize|migrate|implement|geliştir|kodla)\\b/i.test(latestUserMessage)\n')
        new_lines.append('      if (needsPlanning) {\n')
        new_lines.append('        const autoPlan = await generateAutoPlan(latestUserMessage, activeTools, [], controller.signal, journalTask.id)\n')
        new_lines.append('        if (autoPlan.ok && autoPlan.plan) {\n')
        new_lines.append('          await makeTaskPlan(autoPlan.plan)\n')
        new_lines.append('          activity(\'tool\', \'Otonom plan oluşturuldu\', autoPlan.plan.title, { taskId: journalTask.id })\n')
        new_lines.append('        }\n')
        new_lines.append('      }\n')
        new_lines.append('    }\n')
        
        # Skip the old section until "const resumeInstructions"
        while i < len(lines) and 'const resumeInstructions' not in lines[i]:
            i += 1
        # Don't increment i here, let the loop handle it
        continue
    
    new_lines.append(line)
    i += 1

with open(r'C:\Users\user\Desktop\codexx\electron\main.ts', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print("Done fixing auto-planning section")