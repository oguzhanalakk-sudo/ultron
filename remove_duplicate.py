with open(r'C:\Users\user\Desktop\codexx\electron\main.ts', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find and remove the duplicate auto-planning section in the IPC handlers section
# It starts around line 4664 and ends around line 4679

new_lines = []
skip = False
for i, line in enumerate(lines):
    # Start skipping at "    // Variable declarations moved up for auto-planning" in the wrong place
    if i >= 4663 and '// Variable declarations moved up for auto-planning' in line:
        skip = True
        continue
    if skip:
        if '    }' in line and 'await makeTaskPlan' not in lines[max(0, i-1)]:
            # End of the duplicate block - this is just a closing brace
            skip = False
            continue
        continue
    new_lines.append(line)

with open(r'C:\Users\user\Desktop\codexx\electron\main.ts', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print("Removed duplicate section")