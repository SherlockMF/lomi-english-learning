// Template-example audit for the trusted v5.2 pack.
// Blanks the target expression in every example, normalizes pronouns/auxiliaries,
// and clusters identical skeletons into template families.
import { readFileSync } from 'node:fs'

const pack = JSON.parse(readFileSync('data/vocabulary-packs/trusted_v5_2_vocabulary_pack.json', 'utf8'))
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
let zhArtifact = 0
for (const w of pack.words) {
  for (const ex of w.examples ?? []) {
    totalEx += 1
    const sk = skeleton(ex.en, w)
    if (!bySkel.has(sk)) bySkel.set(sk, [])
    bySkel.get(sk).push({ expr: w.expression, en: ex.en, zh: ex.zh, id: w.id })
    if (/的的|地地|在水中的| underwater/.test(String(ex.zh ?? ''))) zhArtifact += 1
  }
}

const families = [...bySkel.entries()]
  .filter(([, v]) => v.length >= 3)
  .sort((a, b) => b[1].length - a[1].length)
const inFamilies = families.reduce((sum, [, v]) => sum + v.length, 0)
const wordsAffected = new Set(families.flatMap(([, v]) => v.map((e) => e.id)))

console.log('例句总数:', totalEx, '| 唯一骨架:', bySkel.size)
console.log('模板家族(≥3次):', families.length, '个家族，覆盖例句', inFamilies, '条 (', Math.round((inFamilies / totalEx) * 100), '% )')
console.log('受影响词条(去重):', wordsAffected.size)
console.log('zh 可疑例句:', zhArtifact)
console.log('=== 前 30 个模板家族 ===')
for (const [sk, v] of families.slice(0, 30)) {
  console.log(String(v.length).padStart(4), sk.slice(0, 90), '  例:', v[0].expr)
}
