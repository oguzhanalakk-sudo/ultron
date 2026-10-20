const fileOperationIntent = /(?:dosya|dosyayı|dosyalar|file|files|kod|code|fonksiyon|function|class|component|uygulama).*(?:düzelt\w*|oluştur\w*|yaz\w*|değiştir\w*|güncelle\w*|ekle\w*|taslak|uygula\w*)|(?:düzelt\w*|oluştur\w*|yaz\w*|değiştir\w*|güncelle\w*|ekle\w*|refactor\w*|implement\w*|fix\w*|create\w*|edit\w*|modify\w*|update\w*).*(?:dosya|file|kod|code|fonksiyon|function|class|component|proje|project)|taslak hazırla/i
const additionalFileOperationIntent = /(?:dosya|file|files|kod|code|fonksiyon|function|class|component|uygulama|application|app|proje|project|feature).*(?:düzenle\w*|geliştir\w*|iyileştir\w*|yenile\w*|write\w*|change\w*|add\w*|apply\w*|remove\w*|delete\w*|improve\w*)|(?:düzenle\w*|geliştir\w*|iyileştir\w*|yenile\w*|write\w*|change\w*|add\w*|apply\w*|remove\w*|delete\w*|improve\w*).*(?:dosya|file|files|kod|code|fonksiyon|function|class|component|uygulama|application|app|proje|project|feature)/i
const requestedNewApplication = /(?:yeni|sıfırdan(?:\s+bir)?|bir)\s+(?:yapay\s+zek[âa]\s+)?(?:asistan\p{L}*\s+)?(?:uygulama|application|app)(?:sı)?\s*(?:istiyorum|oluştur\w*|yap\w*|geliştir\w*|başlat\w*)|(?:yapay\s+zek[âa]\s+)?asistan\p{L}*\s+(?:uygulaması\s+)?(?:istiyorum|oluştur\w*|yap\w*|geliştir\w*)|(?:uygulama\p{L}{0,8}|application|app)\s+(?:(?:yapın|yap)(?=$|[\s,.!?;:])|yap(?!ı[^l])\p{L}*(?=$|[\s,.!?;:])|oluştur\p{L}*|geliştir\p{L}*|kodla\p{L}*|başlat\p{L}*)(?=$|[\s,.!?;:])/iu

const negatedFileOperation = /(?:\b(?:hiçbir|herhangi bir|sadece|yalnızca)?\s*(?:dosya|kod|fonksiyon|class|component|uygulama|proje)\p{L}*(?:\s+\p{L}+){0,2}\s+(?:düzeltme|oluşturma|yazma|değiştirme|güncelleme|ekleme|uygulama|silme|dokunma|yapma|yapmayın|yapmayız|yapmasın|yapmamalı)\b|\b(?:değişiklik|dosya değişikliği|kod değişikliği)\s+yapma\b|\b(?:proposal|taslak)\s+(?:oluşturma|yazma|uygulama)\b|\b(?:do not|don't|never)\s+(?:modify|edit|change|write|create|delete|apply)\b(?:\s+(?:(?:any|the|a|an|to)\s+)?(?:files?|code|project))?|\bwithout\s+(?:modifying|editing|changing|writing|creating|deleting)\s+(?:the\s+|any\s+)?(?:files?|code|project)\b)/giu
const additionalNegation = /\b(?:do not|don't|never)\s+(?:improve|refactor|implement|update|add|remove)\b(?:\s+(?:(?:any|the|a|an|to)\s+)?(?:files?|code|project|application|app|features?))?/giu

export function requiresFileOperation(request: string) {
  const affirmativeRequest = request.replace(negatedFileOperation, ' ').replace(additionalNegation, ' ')
  return fileOperationIntent.test(affirmativeRequest) || additionalFileOperationIntent.test(affirmativeRequest) || requestedNewApplication.test(affirmativeRequest)
}

// "Yapay zekâ asistanı uygulaması istiyorum" gibi kısa ürün istekleri, dosya oluşturma
// anlamı taşır. Bu kalıp platform adı içermese bile uygulama başlatıcılarını görünür kılar.
export function requestsNewApplication(request: string) {
  return requestedNewApplication.test(request)
}

// Yeni uygulama isteği, mevcut bir projeyi inceleme/tamamlama isteğinden ayrılmalıdır.
// Aksi halde eski proje bağlamı yeni görevi ele geçirir ve model yeni dosya yazmak
// yerine mevcut dosyaları okumaya başlar.
const existingProjectIntent = /(?<![\p{L}\p{N}])(?:mevcut|var\s+olan|bu\s+proje|üzerinde|üzerine|içinde|devam|sürdür|resume|continue|tamamla|bitir|düzelt|güncelle|refactor|onar|iyileştir|incele|analiz|özet|anlat|açıkla|nasıl\s+yapılır)(?![\p{L}\p{N}])/iu

export function shouldIsolateNewProjectRequest(request: string) {
  return requestsNewApplication(request) && !existingProjectIntent.test(request)
}

// Kullanıcı yalnızca diff/taslak/öneri istiyorsa gerçek dosya değişikliği beklemiyoruz.
// Bu ayrım, taslak teslimini "başarısız" saymamak ve gereksiz çok adımlı plan üretmemek için gerekir.
const proposalOnlyIntent = /(?:taslak|diff|öneri|inceleme|değişiklik\s+önerisi)[^.;\n]{0,80}(?:hazırla|oluştur|göster|bırak|sun|incele)|(?:dosya\p{L}*\s+(?:doğrudan\s+)?(?:yazma|değiştirme|uygulama))|(?:\bdo\s+not\b|\bdon't\b)\s+(?:write|modify|apply|edit)/iu

export function requestsProposalOnly(request: string) {
  return proposalOnlyIntent.test(request)
}

// Salt okuma/content görevlerini tespit eder: içerik özeti veya dosya gösterme istekleri BALINE'den
// (bellekten uydurma) korunmalıdır; bu isteklerde read_file kanıtı zorunlu tutulur.
const readOperationIntent = /içeri(?:ğini|ğinde|ğin|ği)|içini (?:okum|gör|göster)|dosya(?:yı|s[ıi]n[ıi])?\s+oku(?:n|man|mak|yabilir|m|sun)?\b|\bokuyabilir|\bözetle|özet\s+çıkar|okuyup/i

const negatedReadOperation = /(?:içeri(?:ğini|ğin|ği)|içini)\s+(?:gösterme|okuma|görme)|dosya(?:yı|s[ıi]n[ıi])?\s+okuma\b|okuma(?:dan|yarak)\s|\bgösterme\b|\bözetleme\b/i

export function requiresReadOperation(request: string) {
  const affirmativeRequest = request.replace(negatedReadOperation, (match) => ' '.repeat(match.length))
  return readOperationIntent.test(affirmativeRequest)
}
