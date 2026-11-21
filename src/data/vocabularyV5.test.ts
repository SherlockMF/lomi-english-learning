import { describe, expect, it } from 'vitest'
import { hydrateWords } from '../lib/db'
import { snapshotLearningTracks, snapshotMapLearningProgress } from '../lib/learningTracks'
import { ALL_VOCABULARY_LISTS } from './vocabularyLists'
import { handcraftedSeedWords, loadSeedPack } from './seedVocabulary'

const bundled = await loadSeedPack()
const bundledSeedWords = bundled.words.slice(handcraftedSeedWords.length)
const seedWords = bundled.words
const seedMemberships = bundled.memberships

describe('vocabulary V5 trusted library', () => {
  it('keeps 7503 production senses after reviewed dedupe and six distinct additions', () => {
    expect(bundledSeedWords).toHaveLength(37222)
    expect(seedWords).toHaveLength(37462)
    expect(bundledSeedWords.every((item) => /^(v1|core|econ|v6)-/.test(item.id))).toBe(true)
    expect(bundledSeedWords.filter((item) => item.id.startsWith('v1-')).length).toBe(762)
  })

  it('rejects wrap/meta definitions and old template example banks on non-v1 senses', () => {
    const nonV1 = bundledSeedWords.filter((item) => !item.id.startsWith('v1-'))
    expect(
      nonV1.some((item) =>
        /sense of|practical .+ line or phrase|carry out the action|concept expressed by the phrase|in (business|accounting|finance|daily) practice$|used in (business|accounting|finance|daily) work$|as used in study and work$|the daily meaning of |a measured level or proportion relating to|in commercial or accounting use$|banking arrangement or institution role|^costs attributable to |^an investor in |used in business and finance$| in accounting and trade practice$/i.test(
          item.enDefinition,
        ),
      ),
    ).toBe(false)
    expect(
      nonV1.filter(
        (item) =>
          / relating to /i.test(item.enDefinition) &&
          !/^of or relating to/i.test(item.enDefinition) &&
          !/\(law\)/i.test(item.enDefinition) &&
          !/property resulting from being or relating to/i.test(item.enDefinition),
      ).length,
    ).toBe(0)
    expect(
      nonV1.filter((item) =>
        (item.examples || []).some((example) =>
          /Could you show me where to find|In the worksheet we applied|I sorted out the .+ on campus this afternoon|Before we sign, let’s confirm the|Ops put the .+ on this week|We closed the week by settling the|The client asked for clarity on the|We escalated the .+ to the steering group|Legal asked us to redefine the|The kickoff deck covers the|The deal model hinges on the|She explained the .+ in plain English|The briefing clarified the|We validated the .+ against source data|The memo defines the|Add the .+ to tomorrow.?s agenda|Two teams share ownership of the/i.test(
            example.en,
          ),
        ),
      ).length,
    ).toBe(0)
    expect(bundledSeedWords.find((item) => item.expression === 'credit card')?.enDefinition).toMatch(
      /^a card issued/i,
    )
    expect(bundledSeedWords.find((item) => item.expression === 'persist')?.enDefinition).toMatch(
      /continue firmly/i,
    )
    expect(bundledSeedWords.find((item) => item.expression === 'sales commissions')?.enDefinition).toMatch(
      /salespeople|commission/i,
    )
    expect(bundledSeedWords.find((item) => item.expression === 'cost of debt')?.enDefinition).toMatch(
      /cost associated with|interest/i,
    )
    expect(bundledSeedWords.find((item) => item.expression === 'marketing channel')?.enDefinition).toMatch(
      /path|channel/i,
    )
    expect(bundledSeedWords.find((item) => item.expression === 'skin')?.enDefinition).toMatch(
      /outer covering/i,
    )
    expect(bundledSeedWords.find((item) => item.expression === 'trade deficit')?.enDefinition).toMatch(
      /imports over exports|deficit/i,
    )
    expect(bundledSeedWords.find((item) => item.expression === 'delivery ex-warehouse')?.enDefinition).toMatch(
      /warehouse/i,
    )
    expect(bundledSeedWords.find((item) => item.expression === 'economic')?.collocations?.join(' ')).not.toMatch(
      /pilot the economic|scale the economic/i,
    )
    expect(bundledSeedWords.find((item) => item.expression === 'net indebtedness')?.enDefinition).toMatch(
      /debt|owed/i,
    )
    expect(bundledSeedWords.find((item) => item.expression === 'safe deposit box')?.enDefinition).toMatch(
      /vault|valuables|box/i,
    )
    expect(bundledSeedWords.find((item) => item.expression === 'capital employed')?.enDefinition).toMatch(
      /capital used|employed/i,
    )
    expect(bundledSeedWords.find((item) => item.expression === 'institutional investor')?.collocations?.join(' ')).toMatch(
      /appoint|brief|hire|consult|meet|recommend|rely/i,
    )
    expect(bundledSeedWords.find((item) => item.expression === 'institutional investor')?.collocations?.join(' ')).not.toMatch(
      /hedge the institutional investor|price the institutional investor/i,
    )
    expect(bundledSeedWords.find((item) => item.expression === 'safe deposit box')?.examples?.[0]?.en).toMatch(
      /inspect|lease|secure|visit|Access|Security|expire/i,
    )
    expect(bundledSeedWords.find((item) => item.expression === 'safe deposit box')?.examples?.[0]?.en).not.toMatch(
      /Customs released goods/i,
    )
    expect(bundledSeedWords.find((item) => item.expression === 'shipment advice')?.collocations?.join(' ')).toMatch(
      /issue|file|review|sign|attach|archive|draft|circulate|amend/i,
    )
    expect(bundledSeedWords.find((item) => item.expression === 'commercial bank')?.enDefinition).toMatch(
      /retail and commercial|commercial banking/i,
    )
    expect(bundledSeedWords.find((item) => item.expression === 'institutional investor')?.enDefinition).toMatch(
      /organisation|organization|fund|insurer|pools of capital/i,
    )
    expect(bundledSeedWords.find((item) => item.expression === 'acquisition cost')?.enDefinition).toMatch(
      /acquiring|acquisition/i,
    )
    expect(bundledSeedWords.find((item) => item.expression === 'acquisition cost')?.enDefinition).not.toMatch(
      /costs attributable to/i,
    )
    expect(bundledSeedWords.find((item) => item.expression === 'commercial bank')?.enDefinition).toMatch(
      /retail and commercial|commercial banking/i,
    )
    expect(bundledSeedWords.find((item) => item.expression === 'yield gap')?.enDefinition).toMatch(
      /yield|bonds|equities/i,
    )
    expect(bundledSeedWords.find((item) => item.expression === 'advances from customers')?.enDefinition).toMatch(
      /before|advance|customers/i,
    )
    expect(bundledSeedWords.find((item) => item.expression === 'advances from customers')?.collocations?.join(' ')).not.toMatch(
      /appoint|brief the advances/i,
    )
    expect(bundledSeedWords.find((item) => item.expression === 'yield gap')?.examples?.[0]?.en).not.toMatch(
      /memo defines|tomorrow.?s agenda|share ownership/i,
    )
  })

  it('requires real collocations beyond expression repetition', () => {
    const normalize = (value: string) =>
      value
        .normalize('NFKC')
        .trim()
        .toLocaleLowerCase('en-US')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')

    for (const item of bundledSeedWords) {
      const real = (item.collocations || []).filter((col) => {
        const nc = normalize(col)
        const ne = normalize(item.expression)
        return nc && nc !== ne && nc !== normalize(`use ${item.expression}`)
      })
      expect(real.length, item.expression).toBeGreaterThanOrEqual(2)
    }
  })

  it('locks professional fact fixes from the audit', () => {
    const byExpression = (expression: string) =>
      seedWords.find((item) => item.expression === expression)

    expect(byExpression('share capital')?.enDefinition).toMatch(/no par value|Companies Act 2016/i)
    expect(byExpression('Wi-Fi')?.enDefinition).toMatch(/IEEE 802\.11|local-area/i)
    expect(byExpression('tax liability')?.zhGloss).toMatch(/应纳税额|应付税款/)
    expect(byExpression('bond')?.enDefinition).toMatch(/may provide coupons|other form of return/i)
    expect(byExpression('recognition')?.enDefinition).toMatch(/useful information|faithfully represented/i)
    expect(byExpression('bad debt')?.enDefinition).toMatch(/irrecoverable|written off/i)
    expect(byExpression('effective interest rate')?.enDefinition).toMatch(/amortis|amortiz|discount/i)
    expect(byExpression('inventory write-down')?.enDefinition).toMatch(/net realis(?:able|able) value|NRV/i)
    expect(byExpression('recoverable amount')?.enDefinition).toMatch(/fair value less costs of disposal/i)
    expect(byExpression('recoverable amount')?.enDefinition).toMatch(/value in use/i)
  })

  it('locks P0 high-risk audit regressions (facts, variants, POS examples)', () => {
    const byId = (id: string) => seedWords.find((item) => item.id === id)
    const byExpression = (expression: string) =>
      seedWords.find((item) => item.expression === expression)

    expect(byExpression('planet')?.enDefinition).toMatch(/eight planets|IAU 2006/i)
    expect(byExpression('planet')?.enDefinition).not.toMatch(/nine large celestial|Pluto in order/i)
    expect(byExpression('trillion')?.enDefinition).toMatch(/10¹²|1,000,000,000,000/)
    expect(byExpression('trillion')?.enDefinition).not.toMatch(/18 zeros/)
    expect(byExpression('GATT')?.enDefinition).toMatch(/General Agreement on Tariffs and Trade/i)
    expect(byExpression('GATT')?.enDefinition).not.toMatch(/United Nations agency created/i)
    expect(byExpression('warehouse receipt')?.enDefinition).toMatch(/warehouse|stored|document of title/i)
    expect(byExpression('warehouse receipt')?.enDefinition).not.toMatch(/proof of payment/i)
    expect(byExpression('initial margin')?.enDefinition).toMatch(/collateral|deposit|futures|leveraged/i)
    expect(byExpression('initial margin')?.enDefinition).not.toMatch(/profitability/i)
    expect(byExpression('securities and exchange commission')?.enDefinition).toMatch(/regulator|SEC/i)
    expect(byExpression('securities and exchange commission')?.enDefinition).not.toMatch(/^a fee paid/i)
    expect(byExpression('us securities and exchange commission')?.enDefinition).toMatch(/federal regulator|SEC/i)

    const saleAfloat = byExpression('sale afloat')
    expect(saleAfloat?.acceptedEnVariants.join(' ')).not.toMatch(/afioat/i)
    expect(byExpression('stock loan')?.acceptedEnVariants.join(' ')).not.toMatch(/\blone\b/i)
    expect(byExpression('stock ticker')?.acceptedEnVariants.join(' ')).not.toMatch(/ticket/i)
    expect(byExpression('stuffing order')?.acceptedEnVariants.join(' ')).not.toMatch(/stiffing/i)
    expect(byExpression('results management')?.acceptedEnVariants.join(' ')).not.toMatch(/result's/i)
    expect(byExpression('unaudited balance sheet')?.acceptedEnVariants.join(' ')).not.toMatch(/un-audit/i)
    expect(byExpression('superannuation fund')?.acceptedEnVariants.join(' ')).not.toMatch(/super annuation/i)
    expect(byExpression('non-bearer bond')?.acceptedEnVariants.join(' ')).not.toMatch(/non-bear bond/i)

    expect(byId('v1-can-you-offer-a-better-price-for-a-larger--9aaadd1b')?.zhGloss).toMatch(/优惠|价格/)
    expect(byId('v1-sorry-could-you-say-that-again-d65f9c5d')?.zhGloss).toMatch(/再说一遍|再说一次/)

    expect(byExpression('myself')?.examples?.[0]?.en).not.toMatch(/\bthe myself\b/i)
    expect(byExpression('myself')?.examples?.[0]?.en).toMatch(/\bmyself\b/i)
    expect(byExpression('forward market')?.zhGloss).toMatch(/远期/)
    expect(byExpression('forward market')?.zhGloss).not.toMatch(/期货/)
    expect(byExpression('hard currency')?.zhGloss).toMatch(/硬通货|可兑换/)
    expect(byExpression('hard currency')?.zhGloss).not.toMatch(/^硬币$/)
    expect(byExpression('euro')?.enDefinition).not.toMatch(/adopted t$/i)
    expect(byExpression('protein')?.enDefinition).not.toMatch(/meat and$/i)
  })

  it('rejects known typo acceptedEnVariants and keeps V1 sentence glosses intact', () => {
    const banned = [
      /afioat/i,
      /\bstock lone\b/i,
      /stiffing order/i,
      /result's management/i,
      /un-audit balance sheet/i,
      /generally accounting/i,
      /securities and exchanges commission/i,
      /super annuation fund/i,
      /non-bear bond/i,
      /estimate revenue/i,
      /approximate of the cost/i,
    ]
    for (const item of bundledSeedWords) {
      const joined = (item.acceptedEnVariants || []).join(' | ')
      for (const pattern of banned) {
        expect(joined, `${item.id} ${item.expression}`).not.toMatch(pattern)
      }
    }

    const priceAsk = seedWords.find(
      (item) => item.id === 'v1-can-you-offer-a-better-price-for-a-larger--9aaadd1b',
    )
    expect(priceAsk?.zhGloss).toMatch(/优惠|价格/)
    expect(priceAsk?.zhGloss.length).toBeGreaterThan(10)

    const again = seedWords.find((item) => item.id === 'v1-sorry-could-you-say-that-again-d65f9c5d')
    expect(again?.zhGloss).toMatch(/再说/)

    expect(
      bundledSeedWords.find((item) => item.expression === 'GATT')?.acceptedEnVariants.join(' '),
    ).toMatch(/General Agreement on Tariffs and Trade/i)
  })

  it('rejects POS-hostile article/drill examples for non-noun senses', () => {
    const samples = [
      'confirm',
      'myself',
      'approximately',
      'whose',
      'per',
      'frozen',
      'mostly',
      'anyway',
      'vegetarian',
      'reorder',
    ]
    for (const expression of samples) {
      const item = bundledSeedWords.find((row) => row.expression === expression)
      expect(item, expression).toBeTruthy()
      const joined = (item?.examples || []).map((ex) => ex.en).join(' || ')
      expect(joined, expression).not.toMatch(/Pair the .+ with a collocation|weekly drill recycles the /i)
      expect(joined, expression).not.toMatch(new RegExp(`\\bthe ${expression}\\b`, 'i'))
      expect(joined, expression).toMatch(new RegExp(expression, 'i'))
    }

    // Verb "confirm" should use the word as a verb, not "the confirm"
    const confirm = bundledSeedWords.find((row) => row.expression === 'confirm')
    expect(confirm?.examples?.[0]?.en).toMatch(/\bconfirm\b/i)
    expect(confirm?.examples?.[0]?.en).not.toMatch(/\bthe confirm\b/i)
  })

  it('rejects Econ head-noun template definitions for key senses', () => {
    const byExpression = (expression: string) =>
      seedWords.find((item) => item.expression === expression)

    expect(byExpression('bull market')?.enDefinition).toMatch(/rising|confidence/i)
    expect(byExpression('bull market')?.enDefinition).not.toMatch(/bull is bought/i)
    expect(byExpression('bear market')?.enDefinition).toMatch(/falling|confidence/i)
    expect(byExpression('bear market')?.enDefinition).not.toMatch(/bear is bought/i)
    expect(byExpression('forward market')?.enDefinition).toMatch(/forward contract|OTC|future delivery/i)
    expect(byExpression('cost accounting')?.enDefinition).toMatch(/records|analyses|costs/i)
    expect(byExpression('cost accounting')?.enDefinition).not.toMatch(/accounting treatment or practice related to cost$/i)
    expect(byExpression('agency commission')?.enDefinition).toMatch(/fee|commission paid/i)
    expect(byExpression('capital gains tax')?.enDefinition).toMatch(/tax|gains/i)
    expect(byExpression('capital gains tax')?.enDefinition).not.toMatch(/compulsory levy related to capital gains$/i)

    const econ = bundledSeedWords.filter((item) => item.id.startsWith('econ-'))
    expect(
      econ.some((item) => /the market in which .+ is bought, sold, or priced/i.test(item.enDefinition)),
    ).toBe(false)
    expect(econ.some((item) => /a person or party involved in /i.test(item.enDefinition))).toBe(false)
  })

  it('aligns high-confidence Core sense mismatches and drops identical-sense duplicates', () => {
    const byExpr = (expression: string) =>
      seedWords.filter((item) => item.expression.toLocaleLowerCase('en-US') === expression)

    expect(byExpr('general accounting')).toHaveLength(1)
    expect(byExpr('loan capital')).toHaveLength(1)
    expect(byExpr('explicit costs')).toHaveLength(1)
    expect(seedWords.some((item) => item.id === 'econ-206f7025fed625')).toBe(false)
    expect(seedWords.some((item) => item.id === 'econ-3311b09154eb63')).toBe(false)
    expect(seedWords.some((item) => item.id === 'econ-ee4c3a37c5d1c5')).toBe(false)

    const whose = seedWords.find((item) => item.expression === 'whose')
    expect(whose?.zhGloss).toMatch(/谁的/)
    expect(whose?.examples?.[0]?.en).toMatch(/Whose /i)

    const officer = seedWords.find((item) => item.id === 'core-f90409b98ffb61')
    expect(officer?.zhGloss).toMatch(/官员|干事/)
    expect(officer?.examples?.some((ex) => /officer/i.test(ex.en))).toBe(true)

    const single = seedWords.find((item) => item.id === 'core-ce0b1612aa711b')
    expect(single?.partOfSpeech).toMatch(/adjective/i)
    expect(single?.enDefinition).not.toMatch(/baseball|one base/i)
    expect(single?.zhGloss).toMatch(/单身|单一/)

    const herself = seedWords.find((item) => item.expression === 'herself')
    expect(herself?.examples?.some((ex) => /^She completed/i.test(ex.en))).toBe(true)
    expect(herself?.examples?.some((ex) => /^I completed.+herself/i.test(ex.en))).toBe(false)

    const plant = seedWords.find((item) => item.id === 'core-baf0bf92eb7915')
    expect(plant?.zhGloss).toMatch(/植物/)
    expect(plant?.enDefinition).toMatch(/living organism|tree|flower|grass/i)
    expect(plant?.enDefinition).not.toMatch(/factory|industrial plant/i)

    expect(
      bundledSeedWords.filter((item) =>
        (item.examples || []).some((example) =>
          /Pair the .+ with a collocation|spaced-repetition deck|weekly drill recycles the /i.test(example.en),
        ),
      ).length,
    ).toBe(0)
  })

  it('realigns Batch6 WordNet sense mismatches and drops Round9 hostile templates', () => {
    const affect = seedWords.find((item) => item.id === 'core-5c1b9018b1a33a')
    expect(affect?.partOfSpeech).toMatch(/verb/i)
    expect(affect?.enDefinition).toMatch(/influence|produce a change/i)
    expect(affect?.enDefinition).not.toMatch(/feeling or emotion/i)

    const seek = seedWords.find((item) => item.id === 'core-1594b7a4636275')
    expect(seek?.enDefinition).toMatch(/try to find|obtain|achieve/i)
    expect(seek?.enDefinition).not.toMatch(/read\/write head|disk/i)

    const address = seedWords.find((item) => item.id === 'core-c662180230cad1')
    expect(address?.zhGloss).toMatch(/地址|住址/)
    expect(address?.enDefinition).not.toMatch(/computer science/i)

    const override = seedWords.find((item) => item.id === 'econ-1a95769f3608d9')
    expect(override?.partOfSpeech).toMatch(/noun/i)
    expect(override?.zhGloss).toMatch(/佣金/)
    expect(override?.enDefinition).toMatch(/commission/i)

    const regardless = seedWords.find((item) => item.id === 'core-68970a95b4a63f')
    expect(regardless?.partOfSpeech).toMatch(/adverb/i)
    expect(regardless?.examples?.some((ex) => /regardless of/i.test(ex.en))).toBe(true)

    expect(
      bundledSeedWords.filter((item) =>
        (item.examples || []).some((example) =>
          /They chose to .+ after reviewing the risks|Do not .+ unless the contract allows it|Investors preferred a more .+ structure|Make sure the summary stays /i.test(
            example.en,
          ),
        ),
      ).length,
    ).toBe(0)
  })

  it('rebuilds Batch7 garbled professional defs and adj sense mismatches', () => {
    const mandatory = seedWords.find((item) => item.id === 'econ-cd357c16c63f61')
    expect(mandatory?.zhGloss).toMatch(/强制|必须/)
    expect(mandatory?.enDefinition).toMatch(/required|compulsory/i)
    expect(mandatory?.enDefinition).not.toMatch(/recipient of a mandate/i)

    const cleanLc = seedWords.find((item) => item.expression === 'clean letter of credit')
    expect(cleanLc?.enDefinition).toMatch(/letter of credit|documents/i)
    expect(cleanLc?.enDefinition).not.toMatch(/^credit related to /i)

    const batch = seedWords.find((item) => item.expression === 'batch production')
    expect(batch?.enDefinition).toMatch(/batch/i)
    expect(batch?.enDefinition).not.toMatch(/relating to the production of goods/i)

    const affair = seedWords.find((item) => item.id === 'core-883bac1f7b9dc9')
    expect(affair?.zhGloss).toMatch(/事件|事务/)
    expect(affair?.enDefinition).not.toMatch(/sexual relationship/i)

    const basic = seedWords.find((item) => item.id === 'core-61a7508ed1b04e')
    expect(basic?.partOfSpeech).toMatch(/adjective/i)

    expect(
      bundledSeedWords.filter((item) => /^credit related to |^a market associated with /i.test(item.enDefinition)).length,
    ).toBe(0)
  })

  it('keeps historical institution terms annotated with successors (V5.3 temporal policy)', () => {
    const sibor = seedWords.find((item) => item.expression === 'singapore inter-bank offering rate')
    expect(sibor?.zhGloss).toMatch(/历史/)
    expect(sibor?.enDefinition).toMatch(/SORA|historical|discontinued/i)
    expect(sibor?.examples?.some((ex) => /SIBOR|SORA/i.test(ex.en))).toBe(true)

    const opic = seedWords.find((item) => item.expression === 'overseas private investment corporation')
    expect(opic?.enDefinition).toMatch(/DFC|historical/i)
    expect(opic?.zhGloss).toMatch(/历史/)

    const naa = seedWords.find((item) => item.expression === 'national association of accountants')
    expect(naa?.enDefinition).toMatch(/IMA|historical/i)
  })

  it('prints track totals for App tests', () => {
    const items = hydrateWords(seedWords, seedMemberships, ALL_VOCABULARY_LISTS)
    const tracks = snapshotLearningTracks(items, new Set())
    const progress = snapshotMapLearningProgress(items, new Map())
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          seedWords: seedWords.length,
          progressTotal: progress.total,
          tracks: Object.fromEntries(tracks.map((track) => [track.id, track.total])),
        },
        null,
        2,
      ),
    )
    expect(progress.total).toBe(12387)
  })
})
