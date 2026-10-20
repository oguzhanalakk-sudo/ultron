import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeModelProvider, normalizeModelProviderUrl } from '../electron/model-provider.ts'

test('yerel Ollama yalnızca loopback adresinde çalışır ve sondaki slash temizlenir', () => {
  assert.equal(normalizeModelProviderUrl('ollama', 'http://127.0.0.1:11434/v1/'), 'http://127.0.0.1:11434/v1')
  assert.equal(normalizeModelProviderUrl('ollama', 'http://[::1]:11434/v1'), 'http://[::1]:11434/v1')
  assert.equal(normalizeModelProviderUrl('ollama', 'http://localhost:8080/v1'), 'http://localhost:8080/v1')
  assert.throws(() => normalizeModelProviderUrl('ollama', 'http://192.168.1.15:11434/v1'), /loopback/i)
})

test('Ollama sağlayıcısı bulut ve uzak adresleri reddeder', () => {
  assert.throws(() => normalizeModelProviderUrl('ollama', 'https://api.example.com/v1'), /loopback/i)
  assert.throws(() => normalizeModelProviderUrl('ollama', 'https://api.example.com/v1/'), /loopback/i)
})

test('OpenAI uyumlu sağlayıcı HTTPS adresini ve loopback HTTP adresini kabul eder', () => {
  assert.equal(normalizeModelProviderUrl('openai-compatible', 'https://api.example.com/v1/'), 'https://api.example.com/v1')
  assert.equal(normalizeModelProviderUrl('openai-compatible', 'https://api.example.com'), 'https://api.example.com')
  assert.equal(normalizeModelProviderUrl('openai-compatible', 'http://127.0.0.1:1234/v1'), 'http://127.0.0.1:1234/v1')
  assert.equal(normalizeModelProviderUrl('openai-compatible', 'http://localhost:1234/v1'), 'http://localhost:1234/v1')
})

test('OpenAI uyumlu sağlayıcı tam sohbet uç noktasını taban adrese indirger', () => {
  assert.equal(normalizeModelProviderUrl('openai-compatible', 'https://api.example.com/v1/chat/completions'), 'https://api.example.com/v1')
  assert.equal(normalizeModelProviderUrl('openai-compatible', 'https://api.example.com/v1/models'), 'https://api.example.com/v1')
})

test('API anahtarı şifresiz ağ üzerinden gönderilmez; uzak HTTP reddedilir', () => {
  assert.throws(() => normalizeModelProviderUrl('openai-compatible', 'http://192.168.1.5:1234/v1'), /HTTPS gerekir/i)
  assert.throws(() => normalizeModelProviderUrl('openai-compatible', 'http://api.example.com/v1'), /HTTPS gerekir/i)
})

test('sağlayıcı URLsi kullanıcı bilgisi, sorgu, fragment ve dosya protokolünü reddeder', () => {
  assert.throws(() => normalizeModelProviderUrl('openai-compatible', 'https://user:pass@api.example.com/v1'), /kullanıcı adı veya parola/i)
  assert.throws(() => normalizeModelProviderUrl('openai-compatible', 'https://api.example.com/v1?key=secret'), /sorgu parametresi/i)
  assert.throws(() => normalizeModelProviderUrl('openai-compatible', 'https://api.example.com/v1#secret'), /fragment/i)
  assert.throws(() => normalizeModelProviderUrl('openai-compatible', 'file:///C:/secret.txt'), /HTTP veya HTTPS/i)
})

test('sağlayıcı kimliği yalnızca desteklenen iki değeri kabul eder', () => {
  assert.equal(normalizeModelProvider('ollama'), 'ollama')
  assert.equal(normalizeModelProvider('openai-compatible'), 'openai-compatible')
  assert.equal(normalizeModelProvider('openai'), null)
  assert.equal(normalizeModelProvider('bogus'), null)
})