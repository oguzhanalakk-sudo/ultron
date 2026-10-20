with open(r'C:\Users\user\Desktop\codexx\electron\main.ts', 'r', encoding='utf-8') as f:
    c = f.read()

insert = '''
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

c = c.replace("case 'list_files': {", insert + "    case 'list_files': {")

with open(r'C:\Users\user\Desktop\codexx\electron\main.ts', 'w', encoding='utf-8') as f:
    f.write(c)

print("Done")