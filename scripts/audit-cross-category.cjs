// One-off deep audit: cross-category collisions, id/senseKey uniqueness,
// example length outliers, CEFR + priority distributions.
const fs = require('fs')
const dir = 'data/vocabulary-packs/expansion-v6/chunks/'
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
const norm = (s) => String(s ?? '').normalize('NFKC').trim().toLowerCase()

const byExpr = new Map()
const ids = new Map()
const senseKeys = new Map()
let badExampleLen = 0
let noLevel = 0
const levelCount = {}
const prioByCat = {}

for (const f of files) {
  const c = JSON.parse(fs.readFileSync(dir + f, 'utf8'))
  const cat = c.category
  const sub = c.subcategory
  for (const w of c.words) {
    const k = norm(w.expression)
    if (!byExpr.has(k)) byExpr.set(k, [])
    byExpr.get(k).push({ cat, sub, gloss: w.zhGloss, pos: w.partOfSpeech, file: f, id: w.id })
    if (ids.has(w.id)) console.log('DUP ID:', w.id, '←', f, '和', ids.get(w.id))
    ids.set(w.id, f)
    if (senseKeys.has(w.senseKey)) console.log('DUP senseKey:', w.senseKey, '←', f, '和', senseKeys.get(w.senseKey))
    senseKeys.set(w.senseKey, f)
    if (w.vocabularyLevel === undefined) noLevel++
    else levelCount[w.vocabularyLevel] = (levelCount[w.vocabularyLevel] || 0) + 1
    prioByCat[cat] = prioByCat[cat] || {}
    prioByCat[cat][w.priority] = (prioByCat[cat][w.priority] || 0) + 1
    for (const ex of w.examples || []) {
      const n = String(ex.en || '').trim().split(/\s+/).length
      if (n < 8 || n > 20) badExampleLen++
    }
  }
}

let crossCat = 0
const sameGloss = []
for (const [k, v] of byExpr) {
  const cats = new Set(v.map((x) => x.cat))
  if (cats.size > 1) {
    crossCat++
    for (let i = 0; i < v.length; i++) {
      for (let j = i + 1; j < v.length; j++) {
        if (v[i].gloss === v[j].gloss) {
          sameGloss.push(`${k} → ${v[i].cat}/${v[i].sub} = ${v[i].gloss} | ${v[j].cat}/${v[j].sub}`)
        }
      }
    }
  }
}

console.log('总词条:', ids.size)
console.log('唯一 expression 数:', byExpr.size)
console.log('DUP id / senseKey: (上方单独输出, 无则干净)')
console.log('出现在多个分类的表达数:', crossCat)
console.log('跨分类完全同释义条目:', sameGloss.length)
for (const line of sameGloss.slice(0, 40)) console.log('  ', line)
console.log('无 vocabularyLevel 词条:', noLevel)
console.log('CEFR 分布:', JSON.stringify(levelCount))
console.log('例句词数出界(<8或>20):', badExampleLen)
console.log('=== priority 分布(按分类) ===')
for (const [cat, ps] of Object.entries(prioByCat).sort()) console.log(cat.padEnd(14), JSON.stringify(ps))
