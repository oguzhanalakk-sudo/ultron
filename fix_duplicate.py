with open(r'C:\Users\user\Desktop\codexx\electron\main.ts', 'r', encoding='utf-8') as f:
    c = f.read()

# Remove duplicate case handler - keep only first one
# Find the second occurrence and remove it
marker = '    case "open_url": {'
first = c.find(marker)
if first != -1:
    second = c.find(marker, first + 1)
    if second != -1:
        # Find the end of the second case (next case or closing brace)
        next_case = c.find("case 'list_files': {", second)
        if next_case != -1:
            # Remove from second case to before list_files
            c = c[:second] + c[next_case:]
            print("Removed duplicate case handler")

with open(r'C:\Users\user\Desktop\codexx\electron\main.ts', 'w', encoding='utf-8') as f:
    f.write(c)

print("Fixed duplicate")