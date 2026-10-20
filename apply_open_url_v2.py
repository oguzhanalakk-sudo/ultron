with open(r'C:\Users\user\Desktop\codexx\electron\main.ts', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# 1. Find line with 'open_file' tool definition and insert after it
tool_def_line = None
for i, line in enumerate(lines):
    if 'name: \'open_file\'' in line or 'name: "open_file"' in line:
        tool_def_line = i
        break

if tool_def_line is not None:
    # Find the end of this tool definition (line ending with "},")
    end_line = None
    for i in range(tool_def_line, min(tool_def_line + 20, len(lines))):
        if lines[i].strip().endswith('},'):
            end_line = i
            break
    
    if end_line is not None:
        tool_def = '  { type: "function", function: { name: "open_url", description: "Bir web adresini (http/https) sistem varsayılan tarayıcısında açar. Sadece http: ve https: protokollerine izin verilir. Yerel dosya veya özel protokoller (file:, ftp:, vb.) desteklenmez.", parameters: { type: "object", properties: { url: { type: "string", maxLength: 2048, description: "Açılacak web adresi (örn. https://google.com)" } }, required: ["url"] } } },\n'
        lines.insert(end_line + 1, tool_def)
        print(f"Added tool definition after line {end_line}")
    else:
        print("Could not find end of open_file tool")
else:
    print("Could not find open_file tool line")

# 2. Find the open_file case handler and insert after it (before list_files)
case_end_line = None
for i, line in enumerate(lines):
    if "case 'list_files':" in line or 'case "list_files":' in line:
        case_end_line = i
        break

if case_end_line is not None:
    case_handler = '''    case "open_url": {
      const url = String(args.url ?? "").trim()
      if (!url) throw new Error("url parametresi gerekli")
      try {
        const parsed = new URL(url)
        if (!["http:", "https:"].includes(parsed.protocol)) {
          throw new Error("Sadece http: ve https: protokollerine izin verilir")
        }
      } catch {
        throw new Error("Geçersiz URL formatı")
      }
      await shell.openExternal(url)
      activity("success", "URL tarayıcıda açıldı", url, { tool: "open_url", operation: "url-open", target: url, result: "success" })
      return JSON.stringify({ ok: true, url, message: "URL sistem varsayılan tarayıcısında açıldı." })
    }

'''
    lines.insert(case_end_line, case_handler)
    print(f"Added case handler before line {case_end_line}")
else:
    print("Could not find list_files case")

with open(r'C:\Users\user\Desktop\codexx\electron\main.ts', 'w', encoding='utf-8') as f:
    f.writelines(lines)

print("Done!")