#!/usr/bin/env node

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { performance } = require('perf_hooks')
const { buildTranslationRequest } = require('../src/pc/local-translate/backend')

const endpoint = process.argv[2]
const label = process.argv[3]
const outputPath = process.argv[4]

if (!endpoint || !label || !outputPath) {
  console.error('Usage: node benchmarks/run-translation.js <openai-base-url> <label> <output.json>')
  process.exit(2)
}

const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'translation-cases.json'), 'utf8'))

async function runCase (testCase) {
  const request = buildTranslationRequest(
    { runtime: 'llama.cpp', model: label },
    testCase
  )
  const started = performance.now()
  const response = await fetch(`${endpoint.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  })
  const elapsedMs = Math.round(performance.now() - started)
  if (!response.ok) throw new Error(`${testCase.id}: HTTP ${response.status} ${await response.text()}`)

  const body = await response.json()
  const translation = body?.choices?.[0]?.message?.content?.trim()
  if (!translation) throw new Error(`${testCase.id}: empty translation`)

  return {
    id: testCase.id,
    source: testCase.source,
    target: testCase.target,
    text: testCase.text,
    context: testCase.context || [],
    focus: testCase.focus,
    preserve: testCase.preserve || [],
    preserved: (testCase.preserve || []).filter((value) => translation.includes(value)),
    translation,
    elapsedMs,
    promptTokens: body.usage?.prompt_tokens ?? null,
    completionTokens: body.usage?.completion_tokens ?? null
  }
}

async function main () {
  assert(cases.length === 30)
  const results = []
  for (const [index, testCase] of cases.entries()) {
    process.stderr.write(`[${index + 1}/${cases.length}] ${testCase.id}\n`)
    results.push(await runCase(testCase))
  }

  const elapsed = results.map((result) => result.elapsedMs).sort((a, b) => a - b)
  const required = results.reduce((count, result) => count + result.preserve.length, 0)
  const preserved = results.reduce((count, result) => count + result.preserved.length, 0)
  const report = {
    label,
    endpoint,
    generatedAt: new Date().toISOString(),
    summary: {
      cases: results.length,
      medianMs: elapsed[Math.floor(elapsed.length / 2)],
      p95Ms: elapsed[Math.floor(elapsed.length * 0.95)],
      preservation: `${preserved}/${required}`
    },
    results
  }

  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true })
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report.summary))
}

main().catch((error) => {
  console.error(error.stack || error.message)
  process.exit(1)
})
