import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { expect, test, type Page } from '@playwright/test'
import type { LearningTrack, ReviewAttempt, StudyTimeEntry, UserSettings, VocabularyList, Word, WordListItem } from '../src/domain/types'

type StoredRecords = { words: Word[]; tracks: LearningTrack[]; attempts: ReviewAttempt[]; timeEntries: StudyTimeEntry[];
  settings: UserSettings[]; vocabularyLists: VocabularyList[]; wordListItems: WordListItem[] }

const origin = 'http://127.0.0.1:5188'
const canonicalJsonValue = (_key: string, value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) : value
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value, canonicalJsonValue)).digest('hex')

test.beforeEach(async ({ context }) => {
  // Each context starts empty. No credentials, network services or microphone are used.
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) return route.abort()
    if (url.pathname.startsWith('/api/') && url.pathname !== '/api/voice/config') {
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"message":"Offline acceptance test"}}' })
    }
    return route.continue()
  })
})

async function boot(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '今日学习计划' })).toBeVisible({ timeout: 60_000 })
}

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const databases = await indexedDB.databases()
    const name = databases.find(database => database.name?.includes('recall'))?.name
    if (!name) throw new Error('Missing learning database')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name)
      request.addEventListener('success', () => resolve(request.result), { once: true })
      request.addEventListener('error', () => reject(request.error), { once: true })
    })
    try {
      const stores = ['words', 'tracks', 'attempts', 'timeEntries', 'settings', 'vocabularyLists', 'wordListItems']
      const transaction = db.transaction(stores, 'readonly')
      const result: Record<string, unknown[]> = {}
      await Promise.all(stores.map(storeName => new Promise<void>((resolve, reject) => {
        const request = transaction.objectStore(storeName).getAll()
        request.addEventListener('success', () => { result[storeName] = request.result; resolve() }, { once: true })
        request.addEventListener('error', () => reject(request.error), { once: true })
      })))
      const rows = result as StoredRecords
      // oxlint-disable-next-line consistent-function-scoping -- This callback executes in Chromium and cannot capture Node helpers.
      const canonical = (_key: string, value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) : value
      const digest = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value, canonical)))))
        .map(byte => byte.toString(16).padStart(2, '0')).join('')
      const hashes = Object.fromEntries(await Promise.all(stores.map(async storeName => [storeName, await digest(result[storeName])])) )
      return { hashes, wordCount: rows.words.length, words: rows.words.filter(word => word.expression === 'interest'),
        otherWordsHash: await digest(rows.words.filter(word => word.expression !== 'interest')),
        tracks: rows.tracks.filter(track => track.reps > 0), attempts: rows.attempts, settings: rows.settings, timeEntries: rows.timeEntries }
    } finally { db.close() }
  })
}

async function openWord(page: Page, expression: string) {
  await page.getByRole('navigation', { name: '主要导航' }).getByRole('button', { name: '词库', exact: true }).click()
  await page.getByRole('textbox', { name: '搜索词库' }).fill(expression)
  const entry = page.getByRole('button', { name: `查看 ${expression} 的详情`, exact: true })
  const more = page.getByRole('button', { name: '显示更多', exact: true })
  // Full-text matches include definitions; the exact headword can be on a later page.
  // oxlint-disable-next-line no-await-in-loop -- Each page must render before deciding whether another click is necessary.
  while (await entry.count() === 0 && await more.isVisible()) await more.click()
  await entry.click()
}

test('cold and returning startup, navigation and search use production assets', async ({ page }, testInfo) => {
  const fetched: string[] = []
  page.on('request', request => { if (/\/data\/bundled/.test(request.url())) fetched.push(new URL(request.url()).pathname) })
  const started = performance.now()
  await boot(page)
  const coldBootMs = performance.now() - started
  expect(fetched.filter(path => path.endsWith('bundledSeedWords.json'))).toHaveLength(1)
  expect(fetched.filter(path => path.endsWith('bundledSeedMemberships.json'))).toHaveLength(1)
  expect(fetched.filter(path => path.endsWith('bundledDictionarySenses.json'))).toHaveLength(1)
  const initialJsBytes = await page.evaluate(() => performance.getEntriesByType('resource')
    .filter(entry => new URL(entry.name).pathname.endsWith('.js'))
    .reduce((sum, entry) => sum + (entry as PerformanceResourceTiming).decodedBodySize, 0))
  const libraryStart = performance.now()
  await openWord(page, 'interest')
  await expect(page.getByRole('dialog')).toBeVisible()
  const librarySearchMs = performance.now() - libraryStart
  await page.getByRole('button', { name: '关闭词条详情' }).click()
  for (const [tab, heading] of [['添加', '把今天遇到的词，变成明天能想起的表达。'], ['口语', '把学过的英语，说出来。'], ['今天', '今日学习计划']]) {
    // oxlint-disable-next-line no-await-in-loop -- Exercise navigation in user order, waiting for each destination.
    await page.getByRole('navigation', { name: '主要导航' }).getByRole('button', { name: tab, exact: true }).click()
    // oxlint-disable-next-line no-await-in-loop -- The next navigation must wait for this lazy module to render.
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
  }
  await expect(page.getByRole('heading', { name: '今日学习计划' })).toBeVisible()
  const before = await snapshot(page)
  fetched.length = 0
  const reopenStart = performance.now()
  await page.reload()
  await expect(page.getByRole('heading', { name: '今日学习计划' })).toBeVisible({ timeout: 60_000 })
  const warmBootMs = performance.now() - reopenStart
  expect(fetched).toEqual([])
  const after = await snapshot(page)
  expect(after.wordCount).toBeGreaterThanOrEqual(7503)
  expect(after.hashes.words).toBe(before.hashes.words)
  const metrics = { coldBootMs, warmBootMs, librarySearchMs, initialJsBytes }
  console.log('PERFORMANCE', JSON.stringify(metrics))
  await testInfo.attach('performance', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' })
  const chunks = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => new URL(entry.name).pathname))
  expect(chunks.some(path => /VoicePractice-.*\.js$/.test(path))).toBe(false)
  await page.getByRole('navigation', { name: '主要导航' }).getByRole('button', { name: '口语', exact: true }).click()
  await expect(page.getByRole('heading', { name: '把学过的英语，说出来。' })).toBeVisible()
  expect(await page.evaluate(() => performance.getEntriesByType('resource').some(entry => /VoicePractice-.*\.js$/.test(new URL(entry.name).pathname)))).toBe(true)
})

test('finishes recall, saves FSRS and survives reopening without AI', async ({ page }) => {
  await boot(page)
  await page.getByRole('button', { name: '打开设置' }).click()
  await page.getByLabel('每日新表达数量', { exact: true }).fill('1')
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await page.getByRole('button', { name: '开始今天的训练' }).click()
  await expect(page.getByRole('button', { name: '想不起来', exact: true })).toBeVisible()
  await expect(page.getByRole('radio')).toHaveCount(0)
  await page.getByRole('button', { name: '想不起来', exact: true }).click()
  const expression = await page.locator('.answer-reveal h1').innerText()
  const meaning = await page.locator('.answer-reveal strong').innerText()
  const correction = page.getByLabel('看完答案后，再正确输入一次')
  if (await correction.isVisible()) await correction.fill(await page.locator('.answer-reveal h1').innerText())
  await page.getByRole('button', { name: /忘记了.*很快再练/ }).click()
  const completed = page.getByRole('heading', { name: '今天的学习计划已完成', exact: true })
  const question = page.locator('#recall-answer')
  for (let remaining = 6; remaining > 0; remaining--) {
    // oxlint-disable-next-line no-await-in-loop -- Finish each saved question before inspecting the next phase.
    await expect(question.or(completed)).toBeVisible()
    // oxlint-disable-next-line no-await-in-loop -- Completion is decided by the rendered phase.
    if (await completed.isVisible()) break
    // oxlint-disable-next-line no-await-in-loop -- The same word is practiced in both directions.
    const label = await page.locator('label[for="recall-answer"]').innerText()
    // oxlint-disable-next-line no-await-in-loop -- Each response follows the preceding question.
    await question.fill(label === '你记得的中文意思' ? meaning : expression)
    // oxlint-disable-next-line no-await-in-loop -- Submit and verify before choosing a rating.
    await page.getByRole('button', { name: '提交回忆', exact: true }).click()
    // oxlint-disable-next-line no-await-in-loop -- A successful model answer must be verified locally.
    await expect(page.getByText('无提示回忆正确', { exact: true })).toBeVisible()
    // oxlint-disable-next-line no-await-in-loop -- Saving the rating advances the session.
    await page.getByRole('button', { name: /想起来了.*正常间隔/ }).click()
  }
  await expect(completed).toBeVisible()
  await page.getByRole('button', { name: '今天先到这里', exact: true }).click()
  await expect(page.getByRole('heading', { name: '今日学习计划' })).toBeVisible()
  await expect(page.getByRole('button', { name: '再学一组', exact: true })).toBeVisible()
  const saved = await snapshot(page)
  expect(saved.attempts.length).toBeGreaterThanOrEqual(2)
  expect(saved.attempts.some(attempt => attempt.evaluationSource === 'reveal')).toBe(true)
  expect(saved.attempts.some(attempt => attempt.correctness === 'correct')).toBe(true)
  const attemptsPerTrack = new Map<string, number>()
  for (const attempt of saved.attempts) {
    attemptsPerTrack.set(attempt.trackId, (attemptsPerTrack.get(attempt.trackId) ?? 0) + 1)
  }
  expect(saved.tracks).toHaveLength(attemptsPerTrack.size)
  for (const [trackId, attemptCount] of attemptsPerTrack) {
    expect(saved.tracks.find(track => track.id === trackId)).toMatchObject({ reps: attemptCount })
  }
  await page.reload()
  await expect(page.getByRole('heading', { name: '今日学习计划' })).toBeVisible({ timeout: 60_000 })
  const reopened = await snapshot(page)
  expect(reopened.attempts).toEqual(saved.attempts)
  expect(reopened.hashes.tracks).toEqual(saved.hashes.tracks)
})

test('editing one sense preserves the other senses and saved edit on reload', async ({ page }) => {
  await boot(page)
  const before = await snapshot(page)
  await openWord(page, 'interest')
  await page.getByRole('button', { name: /^编辑 interest(?:：|$)/ }).click()
  await page.getByLabel('中文义项', { exact: true }).fill('自动验收：此义项的个人释义')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.getByRole('button', { name: '关闭词条详情' })).toBeVisible()
  const edited = await snapshot(page)
  const originals = new Map(before.words.map(word => [word.id, word]))
  const changed = edited.words.filter(word => JSON.stringify(originals.get(word.id)) !== JSON.stringify(word))
  expect(changed).toHaveLength(1)
  expect(edited.words.map(word => word.id)).toEqual(before.words.map(word => word.id))
  expect(changed[0]).toMatchObject({ expression: 'interest', zhGloss: '自动验收：此义项的个人释义', contentEdited: true })
  expect(edited.words.filter(word => word.id !== changed[0].id)).toEqual(before.words.filter(word => word.id !== changed[0].id))
  expect(edited.tracks).toEqual(before.tracks)
  expect(edited.hashes.tracks).toBe(before.hashes.tracks)
  expect(edited.otherWordsHash).toBe(before.otherWordsHash)
  await page.reload()
  await expect(page.getByRole('heading', { name: '今日学习计划' })).toBeVisible({ timeout: 60_000 })
  expect((await snapshot(page)).words.find(word => word.id === changed[0].id)).toEqual(changed[0])
})

test('downloads a backup and restores words, FSRS, reviews and settings after a local change', async ({ page }, testInfo) => {
  await boot(page)
  await page.getByRole('button', { name: '开始今天的训练' }).click()
  await page.getByRole('button', { name: '想不起来', exact: true }).click()
  const correction = page.getByLabel('看完答案后，再正确输入一次')
  if (await correction.isVisible()) await correction.fill(await page.locator('.answer-reveal h1').innerText())
  await page.getByRole('button', { name: /忘记了.*很快再练/ }).click()
  await page.getByRole('button', { name: '退出训练' }).click()
  await page.getByRole('button', { name: '打开设置' }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出学习备份', exact: true }).click()
  const download = await downloadPromise
  const backupPath = testInfo.outputPath('learning-backup.json')
  await download.saveAs(backupPath)
  const backup = JSON.parse(readFileSync(backupPath, 'utf8'))
  expect(backup.version).toBe(3)
  expect(backup.attempts).toHaveLength(1)
  await page.getByRole('button', { name: '关闭设置' }).click()
  await openWord(page, 'abandon')
  await page.getByRole('button', { name: /^设为已会 abandon(?:：|$)/ }).click()
  await expect(page.getByText('已设为已会：abandon', { exact: true })).toBeVisible()
  expect((await snapshot(page)).hashes.words).not.toBe(hash(backup.words))
  await page.getByRole('button', { name: '关闭词条详情' }).click()
  await page.getByRole('button', { name: '打开设置' }).click()
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '导入学习备份', exact: true }).click()
  page.once('dialog', dialog => dialog.accept())
  await (await chooserPromise).setFiles(backupPath)
  await expect(page.getByText(/导入完成：.*次回忆。/)).toBeVisible({ timeout: 60_000 })
  const restored = await snapshot(page)
  expect(restored.hashes.words).toBe(hash(backup.words))
  expect(restored.hashes.tracks).toBe(hash(backup.tracks))
  expect(restored.hashes.vocabularyLists).toBe(hash(backup.lists))
  expect(restored.hashes.wordListItems).toBe(hash(backup.memberships))
  expect(restored.attempts).toEqual(backup.attempts)
  expect(restored.timeEntries).toEqual(backup.timeEntries)
  expect(restored.settings[0]).toEqual(backup.settings)
})
