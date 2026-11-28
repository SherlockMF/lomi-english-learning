import { apiFetch } from './apiFetch'
import type {
  DictionaryMeaning,
  DictionaryResult,
} from '../domain/types'
import {
  DatabaseConnectionError,
  getDatabaseSession,
  getDictionaryCache,
  normalizeDictionaryQuery,
  setDictionaryCache,
} from './db'
import {
  buildBilingualMeanings,
  lookupYoudao,
  youdaoDictVoiceUrl,
  type YoudaoLookupResult,
} from './youdao'

export const DICTIONARY_API_BASE_URL = '/api/dictionary/api/v2/entries/en'
export const DICTIONARY_TIMEOUT_MS = 5_000
/** Bump when cached meaning shape changes (e.g. bilingual senses). */
export const DICTIONARY_RESULT_VERSION = 4

export type DictionaryLookupErrorCode =
  | 'empty-query'
  | 'not-found'
  | 'timeout'
  | 'offline'
  | 'network'
  | 'server'
  | 'invalid-response'
  | 'aborted'

export class DictionaryLookupError extends Error {
  readonly code: DictionaryLookupErrorCode
  readonly status?: number

  constructor(code: DictionaryLookupErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'DictionaryLookupError'
    this.code = code
    this.status = status
  }
}

export interface DictionaryLookupOptions {
  forceRefresh?: boolean
  signal?: AbortSignal
  timeoutMs?: number
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const text = nonEmptyString(entry)
    return text ? [text] : []
  })
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

export function normalizeAudioUrl(value: unknown): string | undefined {
  const audioUrl = nonEmptyString(value)
  if (!audioUrl) return undefined
  if (audioUrl.startsWith('//')) return `https:${audioUrl}`
  if (audioUrl.startsWith('http://')) return `https://${audioUrl.slice('http://'.length)}`
  if (audioUrl.startsWith('https://')) return audioUrl
  if (audioUrl.startsWith('/')) return `https://api.dictionaryapi.dev${audioUrl}`
  return undefined
}

function readMeanings(entries: UnknownRecord[]): DictionaryMeaning[] {
  const meanings: DictionaryMeaning[] = []

  for (const entry of entries) {
    if (!Array.isArray(entry.meanings)) continue
    for (const rawMeaning of entry.meanings) {
      if (!isRecord(rawMeaning)) continue
      const partOfSpeech = nonEmptyString(rawMeaning.partOfSpeech) ?? 'unknown'
      const sharedSynonyms = stringArray(rawMeaning.synonyms)
      if (!Array.isArray(rawMeaning.definitions)) continue

      for (const rawDefinition of rawMeaning.definitions) {
        if (!isRecord(rawDefinition)) continue
        const definition = nonEmptyString(rawDefinition.definition)
        if (!definition) continue
        meanings.push({
          partOfSpeech,
          definition,
          example: nonEmptyString(rawDefinition.example),
          synonyms: uniqueStrings([
            ...sharedSynonyms,
            ...stringArray(rawDefinition.synonyms),
          ]),
        })
      }
    }
  }

  return meanings
}

function readAccentedPhonetics(entries: UnknownRecord[]): {
  ipaUk?: string
  ipaUs?: string
  audioUk?: string
  audioUs?: string
  phonetic?: string
  audioUrl?: string
} {
  let ipaUk: string | undefined
  let ipaUs: string | undefined
  let audioUk: string | undefined
  let audioUs: string | undefined
  let phonetic: string | undefined
  let audioUrl: string | undefined

  for (const entry of entries) {
    if (!phonetic) phonetic = nonEmptyString(entry.phonetic)

    if (!Array.isArray(entry.phonetics)) continue
    for (const rawPhonetic of entry.phonetics) {
      if (!isRecord(rawPhonetic)) continue
      const text = nonEmptyString(rawPhonetic.text)
      const audio = normalizeAudioUrl(rawPhonetic.audio)
      const audioLower = audio?.toLowerCase() ?? ''
      const isUk = audioLower.includes('-uk') || audioLower.includes('_uk') || audioLower.includes('/uk/')
      const isUs = audioLower.includes('-us') || audioLower.includes('_us') || audioLower.includes('/us/')

      if (isUk) {
        if (text && !ipaUk) ipaUk = text
        if (audio && !audioUk) audioUk = audio
      } else if (isUs) {
        if (text && !ipaUs) ipaUs = text
        if (audio && !audioUs) audioUs = audio
      } else {
        if (text && !phonetic) phonetic = text
        if (audio && !audioUrl) audioUrl = audio
      }
    }
  }

  return { ipaUk, ipaUs, audioUk, audioUs, phonetic, audioUrl }
}

export function parseDictionaryResponse(
  payload: unknown,
  query: string,
  fetchedAt = new Date().toISOString(),
): DictionaryResult {
  if (!Array.isArray(payload)) {
    throw new DictionaryLookupError(
      'invalid-response',
      '词典服务返回了无法识别的数据。',
    )
  }

  const entries = payload.filter(isRecord)
  const meanings = readMeanings(entries)
  if (entries.length === 0 || meanings.length === 0) {
    throw new DictionaryLookupError(
      'invalid-response',
      '词典服务没有返回有效释义。',
    )
  }

  const accents = readAccentedPhonetics(entries)

  return {
    schemaVersion: DICTIONARY_RESULT_VERSION,
    query,
    word: nonEmptyString(entries[0].word) ?? query,
    phonetic: accents.phonetic ?? accents.ipaUk ?? accents.ipaUs,
    audioUrl: accents.audioUrl ?? accents.audioUk ?? accents.audioUs,
    ipaUk: accents.ipaUk,
    ipaUs: accents.ipaUs,
    audioUk: accents.audioUk,
    audioUs: accents.audioUs,
    meanings,
    fetchedAt,
  }
}

function browserIsOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

function responseError(response: Response): DictionaryLookupError {
  if (response.status === 404) {
    return new DictionaryLookupError('not-found', '没有找到这个英文词条。请检查拼写，或改用 AI 补全 / 手动填写。', 404)
  }
  if (response.status >= 500) {
    return new DictionaryLookupError(
      'server',
      '词典服务暂时异常，请稍后重试；这不代表词条拼写有误。',
      response.status,
    )
  }
  return new DictionaryLookupError(
    'server',
    `词典服务暂时不可用（HTTP ${response.status}）。也可改用 AI 补全或手动填写。`,
    response.status,
  )
}

function withPreferredAudio(result: DictionaryResult): DictionaryResult {
  const audioUk = youdaoDictVoiceUrl(result.word, 'uk') ?? result.audioUk
  const audioUs = youdaoDictVoiceUrl(result.word, 'us') ?? result.audioUs
  return {
    ...result,
    schemaVersion: DICTIONARY_RESULT_VERSION,
    audioUk,
    audioUs,
    audioUrl: audioUk ?? result.audioUrl ?? audioUs,
  }
}

export function isUsableDictionaryCache(result: DictionaryResult): boolean {
  // Version gate only — bilingual enrichment is best-effort, not a cache validity rule.
  return result.schemaVersion === DICTIONARY_RESULT_VERSION
}

export function composeDictionaryResult(input: {
  query: string
  youdao: YoudaoLookupResult
  english?: DictionaryResult
  fetchedAt?: string
}): DictionaryResult {
  const { query, youdao, english } = input
  const word = english?.word || youdao.word || query
  const meanings = buildBilingualMeanings(youdao.senses, english?.meanings ?? [])

  if (meanings.length === 0) {
    throw new DictionaryLookupError(
      'not-found',
      '没有找到这个英文词条。请检查拼写，或改用 AI 补全 / 手动填写。',
    )
  }

  return withPreferredAudio({
    schemaVersion: DICTIONARY_RESULT_VERSION,
    query,
    word,
    phonetic: english?.phonetic ?? youdao.phonetic ?? youdao.ipaUk ?? youdao.ipaUs,
    ipaUk: english?.ipaUk ?? youdao.ipaUk,
    ipaUs: english?.ipaUs ?? youdao.ipaUs,
    audioUk: english?.audioUk,
    audioUs: english?.audioUs,
    audioUrl: english?.audioUrl,
    meanings,
    fetchedAt: input.fetchedAt ?? new Date().toISOString(),
  })
}

async function fetchFreeDictionary(
  query: string,
  signal: AbortSignal,
): Promise<DictionaryResult> {
  const response = await apiFetch(
    `${DICTIONARY_API_BASE_URL}/${encodeURIComponent(query)}`,
    { signal },
  )
  if (!response.ok) throw responseError(response)

  let payload: unknown
  try {
    const text = await response.text()
    const trimmed = text.trim()
    if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
      throw new DictionaryLookupError(
        'invalid-response',
        '词典代理未生效（收到了网页而不是词典数据）。请用分享包里的「启动 Recall English.command」或 node server.mjs 启动，不要直接打开 index.html。',
      )
    }
    payload = JSON.parse(text)
  } catch (error) {
    if (error instanceof DictionaryLookupError) throw error
    throw new DictionaryLookupError(
      'invalid-response',
      '词典服务返回了无效的 JSON。',
    )
  }

  return parseDictionaryResponse(payload, query)
}

export async function lookupDictionary(
  rawQuery: string,
  options: DictionaryLookupOptions = {},
): Promise<DictionaryResult> {
  const query = rawQuery.trim()
  const normalizedQuery = normalizeDictionaryQuery(query)
  if (!normalizedQuery) {
    throw new DictionaryLookupError('empty-query', '请输入要查询的英文单词。')
  }

  const database = getDatabaseSession()
  if (!options.forceRefresh) {
    const cached = await getDictionaryCache(normalizedQuery)
    if (cached && isUsableDictionaryCache(cached.result)) {
      return withPreferredAudio(cached.result)
    }
  }

  if (browserIsOffline()) {
    database.assertCurrent()
    const cached = await getDictionaryCache(normalizedQuery)
    if (cached) return withPreferredAudio(cached.result)
    throw new DictionaryLookupError('offline', '当前处于离线状态，且本地没有该词条。')
  }
  if (options.signal?.aborted) {
    throw new DictionaryLookupError('aborted', '词典查询已取消。')
  }

  const controller = new AbortController()
  let timedOut = false
  const timeoutMs = options.timeoutMs ?? DICTIONARY_TIMEOUT_MS
  const timeoutId = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const handleExternalAbort = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', handleExternalAbort, { once: true })

  try {
    // Chinese senses are the learning unit; Free Dictionary is optional assist + IPA.
    const [youdaoOutcome, englishOutcome] = await Promise.all([
      lookupYoudao(query, { signal: controller.signal, timeoutMs }),
      fetchFreeDictionary(query, controller.signal).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      ),
    ])

    if (!youdaoOutcome.senses.length && !englishOutcome.ok) {
      throw englishOutcome.error
    }

    const composed = composeDictionaryResult({
      query,
      youdao: youdaoOutcome,
      english: englishOutcome.ok ? englishOutcome.value : undefined,
    })
    database.assertCurrent()
    await setDictionaryCache(normalizedQuery, composed)
    return composed
  } catch (error) {
    if (error instanceof DictionaryLookupError || error instanceof DatabaseConnectionError) throw error
    if (timedOut) {
      throw new DictionaryLookupError('timeout', '词典查询超时，请稍后重试。')
    }
    if (options.signal?.aborted) {
      throw new DictionaryLookupError('aborted', '词典查询已取消。')
    }
    if (browserIsOffline()) {
      throw new DictionaryLookupError('offline', '当前处于离线状态，且本地没有该词条。')
    }
    if (error instanceof TypeError) {
      throw new DictionaryLookupError(
        'network',
        '无法连接词典服务。请确认用 npm run dev 启动（本地代理），或改用 AI 补全 / 手动填写。',
      )
    }
    throw new DictionaryLookupError('network', '词典查询失败。可改用 AI 补全或手动填写。')
  } finally {
    clearTimeout(timeoutId)
    options.signal?.removeEventListener('abort', handleExternalAbort)
  }
}
