with open(r'C:\Users\user\Desktop\codexx\electron\main.ts', 'r', encoding='utf-8') as f:
    c = f.read()

# 1. Add tool definition after open_file
tool_def = '''
  { type: "function", function: { name: "open_url", description: "Bir web adresini (http/https) sistem varsayılan tarayıcısında açar. Sadece http: ve https: protokollerine izin verilir. Yerel dosya veya özel protokoller (file:, ftp:, vb.) desteklenmez.", parameters: { type: "object", properties: { url: { type: "string", maxLength: 2048, description: "Açılacak web adresi (örn. https://google.com)" } }, required: ["url"] } } },'''

# Find open_file tool and add after it
marker1 = '"open_file", description: "Kapsam'
if marker1 in c:
    c = c.replace(marker1, marker1 + tool_def)
    print("Added tool definition")
else:
    print("ERROR: Could not find open_file tool marker")

# 2. Add case handler after open_file case, before list_files
case_handler = '''
    case "open_url": {
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

# Find the end of open_file case (before list_files)
marker2 = "case 'list_files': {"
if marker2 in c:
    c = c.replace(marker2, case_handler + "    " + marker2)
    print("Added case handler")
else:
    print("ERROR: Could not find list_files case marker")

with open(r'C:\Users\user\Desktop\codexx\electron\main.ts', 'w', encoding='utf-8') as f:
    f.write(c)

print("Done!")