/**
 * Güvenli uygulama başlatma listesi.
 *
 * `open_application` aracı, tam masaüstü kontrolü kapalıyken de çalışabilen
 * tek uygulama başlatma yoludur. Bu yüzden yalnızca burada tanımlı, açıkça
 * izin verilen uygulama adlarını kabul eder:
 *
 * - Sistem araçları: Hesap Makinesi, Not Defteri, Dosya Gezgini, Paint,
 *   Denetim Paneli, Görev Yöneticisi, Ekran Görüntüsü Aracı.
 * - Tarayıcılar: Microsoft Edge, Google Chrome, Firefox, Brave, Opera, Vivaldi.
 *   Tarayıcı desteği, "bir web sitesini aç" isteğinin masaüstü kontrolü
 *   açılmadan da karşılanabilmesini sağlar.
 *
 * Listede olmayan bir ad reddedilir. Diğer uygulamaları açmak için masaüstü
 * kontrolü açılmalı ve `desktop_launch_app` kullanılmalıdır.
 */
export const ALLOWED_APPLICATIONS = [
  'hesap makinesi',
  'not defteri',
  'dosya gezgini',
  'paint',
  'denetim paneli',
  'görev yöneticisi',
  'ekran görüntüsü aracı',
  'microsoft edge',
  'google chrome',
  'chrome',
  'firefox',
  'brave',
  'opera',
  'vivaldi',
] as const

export type AllowedApplication = (typeof ALLOWED_APPLICATIONS)[number]

export function normalizeAppName(value: string): string {
  return value.trim().toLocaleLowerCase('tr-TR')
}

export function validateAppName(raw: string): AllowedApplication {
  const name = normalizeAppName(raw)
  const match = ALLOWED_APPLICATIONS.find((allowed) => allowed === name)
  if (!match) {
    throw new Error(
      'open_application aracı yalnızca izin verilen uygulama adlarını kabul eder. ' +
      'İzin verilen uygulamalar: ' + ALLOWED_APPLICATIONS.join(', ') +
      '. "google" uygulama değil; web sayfası açmak için URL açma akışı kullanın.'
    )
  }
  return match
}

/**
 * Mağaza uygulamaları (Hesap Makinesi, Not Defteri) pencereyi **ayrı bir süreçte**
 * açar; bu yüzden pencere doğrulaması süreç adıyla değil, pencere başlığıyla yapılır.
 * Her uygulama için birden fazla başlık varyantı tanımlıdır (Türkçe/İngilizce).
 */
export const APPLICATION_WINDOW_TITLES: Record<AllowedApplication, string[]> = {
  'hesap makinesi': ['Hesap Makinesi', 'Calculator'],
  'not defteri': ['Not Defteri', 'Notepad'],
  'dosya gezgini': ['Dosya Gezgini', 'File Explorer'],
  paint: ['Paint'],
  'denetim paneli': ['Denetim Paneli', 'Control Panel'],
  'görev yöneticisi': ['Görev Yöneticisi', 'Task Manager'],
  'ekran görüntüsü aracı': ['Ekran Görüntüsü', 'Snipping Tool'],
  'microsoft edge': ['Microsoft Edge', 'Edge'],
  'google chrome': ['Google Chrome', 'Chrome'],
  chrome: ['Google Chrome', 'Chrome'],
  firefox: ['Mozilla Firefox', 'Firefox'],
  brave: ['Brave'],
  opera: ['Opera'],
  vivaldi: ['Vivaldi'],
}

/** Pencere doğrulaması için başlık ipuçlarını '|' ile ayrılmış hâlde döndürür. */
export function expectedWindowTitles(name: AllowedApplication): string {
  return (APPLICATION_WINDOW_TITLES[name] ?? []).join('|')
}
