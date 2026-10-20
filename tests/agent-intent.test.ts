import assert from 'node:assert/strict'
import test from 'node:test'
import { requestsNewApplication, requestsProposalOnly, requiresFileOperation, requiresReadOperation, shouldIsolateNewProjectRequest } from '../electron/agent-intent.ts'

test('salt okuma görevlerinde olumsuz eylem sözcükleri düzenleme isteği sayılmaz', () => {
  assert.equal(requiresFileOperation('Yalnızca read_file ile index.js dosyasını oku ve combine fonksiyonunu özetle. Hiçbir dosyayı değiştirme.'), false)
  assert.equal(requiresFileOperation('Sadece projeyi analiz et; dosyalara dokunma.'), false)
  assert.equal(requiresFileOperation('Read the file and explain the bug. Do not modify any files.'), false)
  assert.equal(requiresFileOperation('Do not improve the application.'), false)
  assert.equal(requiresFileOperation('Yalnızca read_file aracını kullan. Hiçbir dosyayı değiştirme, proposal oluşturma ve terminal çalıştırma.'), false)
})

test('olumlu düzenleme isteği, yazma yasağı olsa da değişiklik taslağı gerektirir', () => {
  assert.equal(requiresFileOperation('Dosyayı düzelten bir taslak hazırla; dosyayı doğrudan yazma.'), true)
  assert.equal(requiresFileOperation('Fix the code, but do not write the file.'), true)
  assert.equal(requiresFileOperation('Create a proposal to update the project.'), true)
  assert.equal(requiresFileOperation('Dosyayı düzenle.'), true)
  assert.equal(requiresFileOperation('Uygulamayı geliştir.'), true)
  assert.equal(requiresFileOperation('Write the file and change the code.'), true)
})

test('kısa yeni uygulama isteği gerçek dosya işlemi ve başlatıcı niyeti sayılır', () => {
  assert.equal(requiresFileOperation('Yapay zeka asistanı uygulaması istiyorum.'), true)
  assert.equal(requestsNewApplication('Yapay zeka asistanı uygulaması istiyorum.'), true)
  assert.equal(requestsNewApplication('Sıfırdan bir uygulama geliştir.'), true)
  assert.equal(requestsNewApplication('Mevcut uygulamayı incele.'), false)
})

test('içerik okuma/özetleme isteği read_file kanıtı gerektirir', () => {
  assert.equal(requiresReadOperation('not.txt dosyasının içeriğini oku ve özetle.'), true)
  assert.equal(requiresReadOperation('rapor.md dosyası içeriği göster.'), true)
  assert.equal(requiresReadOperation('config.json dosyasını okuyabilir misin?'), true)
  assert.equal(requiresReadOperation('hata.log içini gör ve nedenleri çıkar.'), true)
  assert.equal(requiresReadOperation('Read the file and summarize it.'), false)
})

test('okuma isteği olmayan görevlerde read_file zorunluluğu oluşmaz', () => {
  assert.equal(requiresReadOperation('Proje klasörünü oluştur.'), false)
  assert.equal(requiresReadOperation('Aslına bakarsan okul projesi için başlangıç şablonu istiyorum.'), false)
  assert.equal(requiresReadOperation('npm test çalıştır.'), false)
  assert.equal(requiresReadOperation('Bu konuyu açıklama yapmadan çöz.'), false)
})

test('okuma yasağı istekleri read_file zorunluluğu üretmez', () => {
  assert.equal(requiresReadOperation('Dosyayı okuma, yalnızca adını söyle.'), false)
  assert.equal(requiresReadOperation('Içeriği gösterme; sadece özet yap demeyin.'), false)
  assert.equal(requiresReadOperation('log dosyasına okumadan dokunma.'), false)
})

test('uygulama yapma istekleri dosya işlemi sayılır', () => {
  assert.equal(requiresFileOperation('Basit bir not defteri uygulaması yap: Tkinter GUI, kaydet/aç, testleri olsun'), true)
  assert.equal(requiresFileOperation('Bana bir web uygulaması yap ve testleri ekle.'), true)
  assert.equal(requiresFileOperation('Mobil uygulaması yapılacak, plan çıkar.'), true)
  assert.equal(requestsNewApplication('Basit bir not defteri uygulaması yap'), true)
})

test('yapı inceleme ve olumsuz yapma formları düzenleme sayılmaz', () => {
  assert.equal(requiresFileOperation('Uygulama yapısını incele ve özetle.'), false)
  assert.equal(requiresFileOperation('Şimdilik yeni uygulama yapma.'), false)
  assert.equal(requiresFileOperation('Yeni uygulama yapmayın; önce planı tartışalım.'), false)
})

test('yeni proje isteği mevcut proje bağlamından ayrılır', () => {
  assert.equal(shouldIsolateNewProjectRequest('bir hesap makinesi uygulaması yapalım'), true)
  assert.equal(shouldIsolateNewProjectRequest('Basit bir not defteri uygulaması yap'), true)
  assert.equal(shouldIsolateNewProjectRequest('Yeni bir web uygulaması oluştur.'), true)
  assert.equal(shouldIsolateNewProjectRequest('Mevcut uygulamaya hesap makinesi ekle.'), false)
  assert.equal(shouldIsolateNewProjectRequest('Uygulamayı tamamla ve kalan adımları bitir.'), false)
  assert.equal(shouldIsolateNewProjectRequest('Uygulama nasıl yapılır, kısaca anlat.'), false)
})

test('yalnızca taslak/diff isteyen görevler ayırt edilir', () => {
  assert.equal(requestsProposalOnly('Önce read_file ile dosyayı oku, sonra propose_file_edit ile sadece diff taslağı hazırla; diskteki dosyayı değiştirme.'), true)
  assert.equal(requestsProposalOnly('Dosyayı düzelten bir taslak hazırla; dosyayı doğrudan yazma.'), true)
  assert.equal(requestsProposalOnly('Fix the code, but do not write the file.'), true)
  assert.equal(requestsProposalOnly('Hesap makinesi uygulamasını oluştur ve çalıştır.'), false)
  assert.equal(requestsProposalOnly('index.js dosyasını düzelt ve testleri çalıştır.'), false)
})
