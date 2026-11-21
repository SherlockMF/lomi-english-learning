// Template-example audit for the expansion-v6 chunks (same method as the v5.2 audit).
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'data', 'vocabulary-packs', 'expansion-v6', 'chunks')
const norm = (s) => String(s ?? '').normalize('NFKC').trim().toLowerCase()

function skeleton(sentence, word) {
  let s = String(sentence).trim().toLowerCase()
  const variants = [norm(word.expression), ...(word.acceptedEnVariants ?? []).map(norm)]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  for (const v of variants) {
    const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    s = s.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '_____')
  }
  if (!s.includes('_____')) {
    const first = norm(word.expression).split(' ')[0]
    if (first && first.length > 2) {
      s = s.replace(new RegExp(`\\b${first}[a-z]*\\b`, 'gi'), '_____')
    }
  }
  return s
    .replace(/[^a-z0-9' _____]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b(i|we|they|he|she|you|our|my|their|his|her)\b/g, 'PRON')
    .replace(/\b(is|are|was|were)\b/g, 'BE')
}

const bySkel = new Map()
let totalEx = 0
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  const c = JSON.parse(readFileSync(join(dir, f), 'utf8'))
  for (const w of c.words) {
    for (const ex of w.examples ?? []) {
      totalEx += 1
      const sk = skeleton(ex.en, w)
      if (!bySkel.has(sk)) bySkel.set(sk, [])
      bySkel.get(sk).push({ expr: w.expression, en: ex.en, cat: c.category, file: f })
    }
  }
}

const families = [...bySkel.entries()]
  .filter(([, v]) => v.length >= 3)
  .sort((a, b) => b[1].length - a[1].length)
const inFamilies = families.reduce((sum, [, v]) => sum + v.length, 0)

console.log('v6 例句总数:', totalEx, '| 唯一骨架:', bySkel.size)
console.log('模板家族(≥3次):', families.length, '个，覆盖例句', inFamilies, '条 (', Math.round((inFamilies / totalEx) * 100), '% )')
console.log('=== 前 15 个家族 ===')
for (const [sk, v] of families.slice(0, 15)) {
  console.log(String(v.length).padStart(4), sk.slice(0, 75), '  例:', v[0].expr, '@' + v[0].file.slice(0, 22))
}
