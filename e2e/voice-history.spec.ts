import { expect, test } from '@playwright/test'

test('voice history survives browser reload, replays stored audio and supports confirmed deletion', async ({ page }, testInfo) => {
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:5188' ? route.continue() : route.abort())
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '今日学习计划' })).toBeVisible({ timeout: 60_000 })
  // Producer integration tests cover automatic writes. Here native IndexedDB and native Blob/audio
  // verify the browser boundary that fake-indexeddb cannot emulate.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('recall-english')
      request.addEventListener('success', () => resolve(request.result), { once: true })
      request.addEventListener('error', () => reject(request.error), { once: true })
    })
    const bytes = new Uint8Array(32044)
    const view = new DataView(bytes.buffer)
    const text = (offset: number, value: string) => [...value].forEach((char, index) => { bytes[offset + index] = char.charCodeAt(0) })
    text(0, 'RIFF'); view.setUint32(4, 32036, true); text(8, 'WAVE'); text(12, 'fmt ')
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
    view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
    text(36, 'data'); view.setUint32(40, 32000, true)
    const record = {
      id: 'browser-history-check', mode: 'messages', scenario: 'daily', description: '咖啡店点单练习', difficulty: 'basic',
      createdAt: '2026-11-02T01:00:00.000Z', updatedAt: '2026-11-02T01:01:00.000Z', elapsedSeconds: 60,
      turns: [{ id: 'u1', role: 'user', text: 'A coffee, please.', final: true, interrupted: false, status: 'sent', duration: 1, audio: new Blob([bytes], { type: 'audio/wav' }) }],
      corrections: {}, feedback: { summaryZh: '已完成咖啡店点单练习。', corrections: [], expressions: [{ en: 'A coffee, please.', zh: '请给我一杯咖啡。' }] },
    }
    const tx = db.transaction('voiceHistory', 'readwrite')
    tx.objectStore('voiceHistory').put(record)
    tx.objectStore('voiceHistory').put({ ...record, id: 'browser-history-second', mode: 'realtime', description: '第二次练习', turns: record.turns.map(({ audio: _audio, ...turn }) => turn) })
    await new Promise<void>((resolve, reject) => {
      tx.addEventListener('complete', () => resolve(), { once: true })
      tx.addEventListener('error', () => reject(tx.error), { once: true })
    })
    db.close()
  })
  await page.reload()
  await page.getByRole('navigation', { name: '主要导航' }).getByRole('button', { name: '口语', exact: true }).click()
  await expect(page.getByRole('button', { name: /回看练习/ })).toHaveCount(2)
  await page.getByRole('button', { name: /回看练习.*语音消息/ }).click()
  await expect(page.getByText('已完成咖啡店点单练习。')).toBeVisible()
  const audio = page.locator('.voice-history-detail audio')
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.readyState)).toBeGreaterThanOrEqual(1)
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.duration)).toBe(1)
  await page.getByRole('button', { name: /播放你的 1 秒语音/ }).click()
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0)
  await page.screenshot({ path: testInfo.outputPath('voice-history-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('heading', { name: '练习历史', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('voice-history-mobile.png'), fullPage: true })
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: /删除练习.*语音消息/ }).click()
  await expect(page.getByRole('button', { name: /回看练习/ })).toHaveCount(2)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: /删除练习.*语音消息/ }).click()
  await expect(page.getByRole('button', { name: /回看练习/ })).toHaveCount(1)
  await expect(page.getByRole('article', { name: '练习历史详情' })).toHaveCount(0)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '清空历史' }).click()
  await expect(page.getByText(/还没有保存的语音练习/)).toBeVisible()
  await page.reload()
  await page.getByRole('navigation', { name: '主要导航' }).getByRole('button', { name: '口语', exact: true }).click()
  await expect(page.getByText(/还没有保存的语音练习/)).toBeVisible()
})
