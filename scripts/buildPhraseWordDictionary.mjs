import { createReadStream, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { phraseWordKey, phraseWordTokens } from '../src/lib/phraseWordTokens.ts'
import { loadHandcraftedSenses } from './lib/handcraftedSenses.mjs'

const [ecdictPath, ipaPath] = process.argv.slice(2)
if (!ecdictPath || !ipaPath) throw new Error('Usage: node scripts/buildPhraseWordDictionary.mjs <ecdict.csv> <en_US.txt>')

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const bundled = JSON.parse(read('../public/data/bundledSeedWords.json'))
const handcrafted = loadHandcraftedSenses(read('../src/data/seedVocabulary.ts'))
const senses = JSON.parse(read('../public/data/bundledDictionarySenses.json')).results
const vocabulary = [...bundled, ...handcrafted]
const keys = new Set(vocabulary.flatMap(word => phraseWordTokens(word.expression).map(token => phraseWordKey(token.word))))
for (const word of keys) {
  keys.add(word.toLowerCase())
  for (const part of word.split('-')) keys.add(part)
}

const glossary = new Map()
for (const word of vocabulary) {
  const key = phraseWordKey(word.expression)
  if (!keys.has(key)) continue
  const entry = glossary.get(key) ?? { glosses: [] }
  if (word.zhGloss) entry.glosses.push(word.zhGloss)
  entry.uk ||= word.ipaUk
  entry.us ||= word.ipaUs
  glossary.set(key, entry)
}
for (const sense of senses) {
  const key = phraseWordKey(sense.query)
  if (!keys.has(key)) continue
  const entry = glossary.get(key) ?? { glosses: [] }
  entry.glosses.push(...sense.meanings.map(meaning => meaning.zhGloss).filter(Boolean))
  entry.uk ||= sense.ipaUk
  entry.us ||= sense.ipaUs
  entry.ipa ||= sense.phonetic
  glossary.set(key, entry)
}

// ECDICT encodes embedded newlines as literal \n. Read only the first four CSV fields.
const ecdict = new Map()
const csv = createInterface({ input: createReadStream(ecdictPath), crlfDelay: Infinity })
for await (const line of csv) {
  const word = line.slice(0, line.indexOf(',')).replace(/^"|"$/g, '')
  const key = phraseWordKey(word)
  if (!keys.has(key)) continue
  const fields = /("(?:[^"]|"")*"|[^,]*)(?:,|$)/gy
  const [, phonetic, , translation] = Array.from({ length: 4 }, () =>
    fields.exec(line)?.[1].replace(/^"|"$/g, '').replaceAll('""', '"') ?? '')
  const ipa = phonetic.trim().replaceAll('ә', 'ə').replaceAll("'", 'ˈ').replaceAll(':', 'ː')
  const glosses = translation.split(/(?:\\r)?\\n|\r?\n/u).map(gloss => gloss.trim()).filter(gloss => /\p{Script=Han}/u.test(gloss))
  if (!ecdict.has(key) || (word === key && glosses.length)) ecdict.set(key, { glosses, ipa })
}

const ipaUs = new Map()
for (const line of readFileSync(ipaPath, 'utf8').split(/\r?\n/u)) {
  const [word, ipa] = line.split('\t')
  const key = phraseWordKey(word)
  if (keys.has(key) && ipa) ipaUs.set(key, ipa)
}

// These high-frequency entries need a learner-friendly first meaning or a missing pronunciation.
const overrides = {
  a: { glosses: ['不定冠词：一个；某个（用于辅音音素前）'], uk: 'ə; eɪ', us: 'ə; eɪ' },
  am: { glosses: ['动词：是；be 与主语 I 连用的现在时形式'], uk: 'æm; əm', us: 'æm; əm' },
  an: { glosses: ['不定冠词：一个；某个（用于元音音素前）'], uk: 'ən; æn', us: 'ən; æn' },
  the: { glosses: ['定冠词：指特定的人或事物；也用于最高级和序数词前'], uk: 'ðə; ðiː', us: 'ðə; ði' },
  payback: { glosses: ['名词：投资回收；偿还', '名词：回报；报复'], uk: 'ˈpeɪbæk', us: 'ˈpeɪbæk' },
  period: { glosses: ['名词：时期；一段时间', '名词：句号；课时'], uk: 'ˈpɪəriəd', us: 'ˈpɪriəd' },
  AI: { glosses: ['缩写：人工智能（artificial intelligence）'], uk: 'ˌeɪ ˈaɪ', us: 'ˌeɪ ˈaɪ' },
  API: { glosses: ['缩写：应用程序编程接口（application programming interface）'], uk: 'ˌeɪ piː ˈaɪ', us: 'ˌeɪ piː ˈaɪ' },
  "hasn't": { glosses: ['has not 的缩写：没有；尚未'], uk: 'ˈhæzənt', us: 'ˈhæzənt' },
  "haven't": { glosses: ['have not 的缩写：没有；尚未'], uk: 'ˈhævənt', us: 'ˈhævənt' },
  "wouldn't": { glosses: ['would not 的缩写：不会；不愿意'], uk: 'ˈwʊdənt', us: 'ˈwʊdənt' },
  'wi-fi': { glosses: ['名词：Wi-Fi；无线网络'], uk: 'ˈwaɪfaɪ', us: 'ˈwaɪfaɪ' },
  'co-op': { glosses: ['名词：合作教育；带有工作实习的学习项目', '名词：合作社；cooperative 的缩写'], uk: 'ˈkəʊɒp', us: 'ˈkoʊɑp' },
  'café': { glosses: ['名词：咖啡馆；提供饮品和简餐的小餐馆'], uk: 'ˈkæfeɪ', us: 'kæˈfeɪ' },
  mic: { glosses: ['名词：麦克风；microphone 的口语简称'], uk: 'maɪk', us: 'maɪk' },
  onboarding: { glosses: ['名词：入职引导；引导新用户熟悉产品或服务的过程'] },
  rollforward: { glosses: ['名词：余额变动表；从期初余额调节到期末余额的明细'] },
  groupwise: { glosses: ['形容词或副词：按组的；逐组地'] },
  "piaget's": { glosses: ['所有格：皮亚杰的；与心理学家让·皮亚杰相关的'] },
  "fick's": { glosses: ['所有格：菲克的；如菲克扩散定律'] },
  "hooke's": { glosses: ['所有格：胡克的；如胡克定律'] },
  "kirchhoff's": { glosses: ['所有格：基尔霍夫的；如基尔霍夫电路定律'] },
  "sylvester's": { glosses: ['所有格：西尔维斯特的；如西尔维斯特判别准则'] },
  "chef's": { glosses: ['所有格：厨师的；主厨的'] },
  "moody's": { glosses: ['专名：穆迪；常指信用评级机构'] },
  "bailee's": { glosses: ['所有格：受托保管人的'] },
  "businessman's": { glosses: ['所有格：商人的'] },
  "salesmen's": { glosses: ['所有格：销售人员的'] },
  "warehousekeeper's": { glosses: ['所有格：仓库保管人的'] },
  subspaces: { glosses: ['名词复数：子空间'] },
  rh: { glosses: ['缩写：Rh 血型系统；如 Rh 阳性或阴性'] },
  whatsapp: { glosses: ['专名：WhatsApp，即时通讯应用'] },
  inventoriable: { glosses: ['形容词：可计入存货成本的'] },
  interdivisional: { glosses: ['形容词：事业部之间的；分部间的'] },
  endian: { glosses: ['字节序；在 big-endian 和 little-endian 中指字节的排列方式'] },
  missingness: { glosses: ['名词：数据缺失的状态或模式'] },
  isocost: { glosses: ['形容词：等成本的；总成本相等的'] },
  unreimbursed: { glosses: ['形容词：未获报销的'] },
  capex: { glosses: ['缩写：资本支出（capital expenditure）'] },
  handback: { glosses: ['名词：归还；按照约定移交'] },
  fob: { glosses: ['名词：钥匙扣；门禁感应钥匙', '缩写：船上交货（free on board）'] },
  rulemaking: { glosses: ['名词：制定规章；行政规则的制定过程'] },
  precontractual: { glosses: ['形容词：合同订立前的；缔约前的'] },
  omnichannel: { glosses: ['形容词：全渠道的；贯通不同销售或服务渠道的'] },
  gershgorin: { glosses: ['人名：盖尔施戈林；如盖尔施戈林圆盘定理'] },
  darboux: { glosses: ['人名：达布；如达布和'] },
  interrater: { glosses: ['形容词：评分者之间的；评定者间的'] },
  socioemotional: { glosses: ['形容词：社会交往与情绪方面的'] },
  rebooking: { glosses: ['名词：改订；重新预订'] },
  seatback: { glosses: ['名词：座椅靠背'] },
  skus: { glosses: ['缩写复数：库存单位；多个库存管理编码'] },
  intracorporate: { glosses: ['形容词：同一公司内部的'] },
  intercorporate: { glosses: ['形容词：公司之间的'] },
  preacquisition: { glosses: ['形容词：收购前的'] },
  overapplied: { glosses: ['形容词：分配过多的；如分配额超过实际间接费用'] },
  underapplied: { glosses: ['形容词：分配不足的；如分配额低于实际间接费用'] },
  annualise: { glosses: ['动词：年化；换算成全年数值（annualize 的英式拼写）'] },
  calendarised: { glosses: ['形容词：按自然历期间对齐的'] },
  insource: { glosses: ['动词：改由内部完成；将外包工作收回自做'] },
  nonmanufacturing: { glosses: ['形容词：非制造的；与生产制造不直接相关的'] },
  plantwide: { glosses: ['形容词：全厂范围的；全厂统一的'] },
  personalisation: { glosses: ['名词：个性化；按个人需要定制（personalization 的英式拼写）'] },
  ads: { glosses: ['名词复数：广告；advertisements 的简称'] },
  meetup: { glosses: ['名词：聚会；碰面活动'] },
  refactor: { glosses: ['动词：重构代码；调整代码内部结构'] },
  unadvertised: { glosses: ['形容词：未公开刊登的；未做广告的'] },
  EBITDA: { glosses: ['缩写：息税折旧摊销前利润'] },
  VRIO: { glosses: ['缩写：价值、稀有性、难以模仿性和组织利用能力'] },
  PAYG: { glosses: ['缩写：随收随缴（pay as you go）；澳大利亚税务中用于预扣或分期预缴'] },
  T4A: { glosses: ['加拿大税务信息单；列报养老金、奖助金等相关收入'] },
  SEVP: { glosses: ['缩写：美国学生和交流访问者项目'] },
  PGWP: { glosses: ['缩写：加拿大毕业后工作许可'] },
  NAATI: { glosses: ['缩写：澳大利亚翻译和口译员国家认证机构'] },
  CRICOS: { glosses: ['缩写：澳大利亚面向海外学生的教育机构与课程注册名录'] },
  ESOS: { glosses: ['缩写：澳大利亚海外学生教育服务法规框架'] },
}

const entries = []
const missingGloss = []
const missingIpa = []
for (const key of [...keys].sort()) {
  const plain = key.toLowerCase()
  const edited = Object.hasOwn(overrides, key) ? overrides[key] : undefined
  const local = glossary.get(key)
  const external = ecdict.get(key) ?? ecdict.get(plain)
  const inherited = key.endsWith("'s") ? ecdict.get(key.slice(0, -2)) : undefined
  const glosses = [...new Set(edited?.glosses ?? [
    ...(local?.glosses ?? []),
    ...(external?.glosses.length ? external.glosses : inherited?.glosses.map(gloss => '所有格 · ' + gloss) ?? []),
  ].map(gloss => gloss.trim().replace(/\s+/gu, ' ')))].slice(0, 4)
  const uk = edited?.uk || local?.uk || ''
  const us = edited?.us || local?.us || ipaUs.get(key) || ''
  const ipa = uk || us ? '' : local?.ipa || external?.ipa || ''
  if (!glosses.length) missingGloss.push(key)
  if (!uk && !us && !ipa) missingIpa.push(key)
  if (glosses.length || uk || us || ipa) entries.push([key, { glosses, ...(uk && { uk }), ...(us && { us }), ...(ipa && { ipa }) }])
}

writeFileSync(new URL('../src/data/phraseWordDictionary.json', import.meta.url),
  '{\n' + entries.map(([key, value]) => '  ' + JSON.stringify(key) + ': ' + JSON.stringify(value)).join(',\n') + '\n}\n')
console.log(JSON.stringify({ words: keys.size, entries: entries.length, missingGloss, missingIpa }))
