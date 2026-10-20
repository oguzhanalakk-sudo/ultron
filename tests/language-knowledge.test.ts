import assert from 'node:assert/strict'
import test from 'node:test'
import { LANGUAGE_KNOWLEDGE_BASE, detectLanguage, getLanguageExtensions, getLanguageInfo, getLanguagesByCategory } from '../electron/language-knowledge.ts'

const advertised = ['typescript', 'python', 'rust', 'go', 'javascript', 'csharp', 'java', 'cpp', 'ruby', 'php', 'swift', 'kotlin', 'scala', 'r', 'matlab', 'sql', 'bash', 'powershell']

test('bilgi bankası araç tanımındaki 18 dili eksiksiz kapsar', () => {
  for (const language of advertised) {
    const info = LANGUAGE_KNOWLEDGE_BASE[language]
    assert.ok(info, `${language} eksik`)
    assert.ok(info.name.length > 0, `${language} adı boş`)
    assert.ok(info.extensions.length > 0, `${language} uzantısı yok`)
    assert.ok(info.commonPatterns.length > 0, `${language} kalıbı yok`)
    assert.ok(info.pitfalls.length > 0, `${language} tuzağı yok`)
    assert.ok(info.styleGuides.length > 0, `${language} stil rehberi yok`)
    assert.ok(info.documentation.length > 0, `${language} dokümantasyonu yok`)
    assert.ok(info.standardLibrary.length > 0, `${language} standart kütüphanesi yok`)
    assert.ok(info.ecosystem.length > 0, `${language} ekosistemi yok`)
    for (const pattern of info.commonPatterns) {
      assert.ok(pattern.name && pattern.description && pattern.codeExample && pattern.useCase, `${language} kalıbı eksik alan içeriyor`)
    }
    for (const pitfall of info.pitfalls) {
      assert.ok(pitfall.name && pitfall.description && pitfall.codeExample && pitfall.fix, `${language} tuzağı eksik alan içeriyor`)
      assert.ok(['critical', 'major', 'minor'].includes(pitfall.severity), `${language} tuzak önem derecesi geçersiz`)
    }
  }
  assert.equal(Object.keys(LANGUAGE_KNOWLEDGE_BASE).length, advertised.length)
})

test('dosya uzantısından dil algılama her dil için çalışır', () => {
  const samples: Record<string, string> = {
    typescript: 'app.ts',
    python: 'main.py',
    rust: 'lib.rs',
    go: 'main.go',
    javascript: 'index.js',
    csharp: 'Program.cs',
    java: 'Main.java',
    cpp: 'engine.cpp',
    ruby: 'app.rb',
    php: 'index.php',
    swift: 'App.swift',
    kotlin: 'Main.kt',
    scala: 'Main.scala',
    r: 'analysis.R',
    matlab: 'plot_signal.m',
    sql: 'schema.sql',
    bash: 'deploy.sh',
    powershell: 'setup.ps1',
  }
  for (const [language, file] of Object.entries(samples)) {
    assert.equal(detectLanguage(file), language, `${file} dosyası ${language} olarak algılanmalı`)
  }
  assert.equal(detectLanguage('README'), undefined)
})

test('getLanguageInfo, uzantı ve kategori sorguları çalışır', () => {
  assert.equal(getLanguageInfo('KOTLIN')?.name, 'Kotlin')
  assert.deepEqual(getLanguageExtensions('rust'), ['.rs'])
  assert.ok(getLanguagesByCategory('mobile').some((info) => info.name === 'Swift'))
  assert.ok(getLanguagesByCategory('data').some((info) => info.name === 'SQL'))
  assert.equal(getLanguageInfo('bilinmeyen'), undefined)
})
