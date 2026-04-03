/**
 * 테마/종목 DB 페이지 매칭 — page mention 링크 생성을 위한 모듈
 *
 * 크롤링한 테마명·종목명을 Notion DB에서 검색하여
 * 매칭되는 페이지가 있으면 notionPageId를 설정합니다.
 */

import {
  notion,
  env,
  getDataSourceId,
  getPageTitle,
  isFullPage,
} from "./notion-client.js"
import type { DailyMarketData } from "../types/market-data.js"

/** 이름/코드 → Notion Page ID 매핑 */
export type PageMap = Map<string, string>

// ─── 문자열 정규화 유틸 ─────────────────────────────────────────

/** fuzzy 매칭용 문자열 정규화: 소문자, 공백/특수문자 제거 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s\-_·・\/\\()（）\[\]【】]/g, "")
    .trim()
}

/** 괄호 내용 제거: "AI(인공지능)" → "AI" */
function stripParens(s: string): string {
  return s
    .replace(/\([^)]*\)/g, "")
    .replace(/（[^）]*）/g, "")
    .trim()
}

// ─── DB 페이지 맵 구축 ─────────────────────────────────────────

/**
 * DB의 전체 페이지를 조회하여 제목 → pageId 맵을 생성합니다.
 * 페이지네이션으로 최대 maxPages개까지 조회합니다.
 */
async function buildPageMap(
  databaseId: string,
  maxPages: number = 1000
): Promise<PageMap> {
  const dataSourceId = await getDataSourceId(databaseId)
  const map: PageMap = new Map()
  let cursor: string | undefined = undefined
  let total = 0

  while (total < maxPages) {
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })

    for (const page of response.results) {
      if (!isFullPage(page)) continue
      const title = getPageTitle(page).trim()
      if (title) {
        // 전체 제목으로 저장
        map.set(title, page.id)

        // 종목 DB: "종목명(코드, 코스피 or 코스닥)" 패턴
        // 종목코드는 영문+숫자 혼합 6자리 (예: 00593A, 03473K)
        const stockMatch = title.match(
          /^(.+?)\(([A-Za-z0-9]{6}),\s*(코스피|코스닥)\)$/
        )
        if (stockMatch) {
          const [, stockName, stockCode] = stockMatch
          map.set(stockCode.toUpperCase(), page.id) // "00593A" → pageId
          map.set(stockName.trim(), page.id) // "삼성전자" → pageId
        }

        // 테마 DB: "테마명(Theme)" 패턴
        const themeMatch = title.match(/^(.+?)\(Theme\)$/)
        if (themeMatch) {
          const themeName = themeMatch[1].trim()
          map.set(themeName, page.id) // "석유/유가" → pageId
        }

        // fallback: 6자리 영숫자 코드가 있는 다른 패턴 대비
        if (!stockMatch && !themeMatch) {
          const codeMatch = title.match(/([A-Za-z0-9]{6})/)
          if (codeMatch) {
            map.set(codeMatch[1].toUpperCase(), page.id)
          }
        }
      }
      total++
    }

    if (!response.has_more || !response.next_cursor) break
    cursor = response.next_cursor
  }

  return map
}

// ─── fuzzy 매칭 ─────────────────────────────────────────────────

/**
 * 정확히 일치하지 않을 때 fuzzy 매칭을 시도합니다.
 * 1) 괄호 내용 제거 후 매칭: "AI(인공지능)" → "AI"
 * 2) 정규화(소문자, 특수문자 제거) 후 매칭
 * 3) 크롤링 이름이 DB 이름을 포함하거나 그 반대 → 길이 비율이 가장 높은 것 선택
 */
function fuzzyMatchTheme(name: string, themeMap: PageMap): string | undefined {
  // 1단계: 괄호 제거 후 exact match
  const stripped = stripParens(name)
  if (stripped !== name) {
    const id = themeMap.get(stripped)
    if (id) return id
  }

  // 2단계: 정규화 후 전수 비교
  const normName = normalize(name)
  const normStripped = normalize(stripped)

  // 정규화 exact match 먼저
  for (const [key, pageId] of themeMap) {
    if (key.endsWith("(Theme)")) continue
    const normKey = normalize(key)
    if (normKey === normName || normKey === normStripped) return pageId
  }

  // 3단계: 포함 관계 매칭 — 길이 비율이 가장 높은(가장 유사한) 것 선택
  let bestId: string | undefined
  let bestRatio = 0

  for (const [key, pageId] of themeMap) {
    if (key.endsWith("(Theme)")) continue
    const normKey = normalize(key)

    if (normName.length >= 2 && normKey.length >= 2) {
      if (normKey.includes(normName) || normName.includes(normKey)) {
        const ratio =
          Math.min(normName.length, normKey.length) /
          Math.max(normName.length, normKey.length)
        if (ratio >= 0.5 && ratio > bestRatio) {
          bestRatio = ratio
          bestId = pageId
        }
      }
    }
  }

  return bestId
}

// ─── 테마 DB 맵 ────────────────────────────────────────────────

let _themeMap: PageMap | null = null

/** 테마 DB의 테마명 → pageId 맵 (캐싱) */
export async function getThemeMap(): Promise<PageMap> {
  if (_themeMap) return _themeMap
  if (!env.THEME_DB_ID) return new Map()

  console.log("  📋 테마 DB 페이지 맵 로드 중...")
  _themeMap = await buildPageMap(env.THEME_DB_ID)
  console.log(`    → ${_themeMap.size}개 테마 로드됨`)
  return _themeMap
}

// ─── 종목 DB 맵 ────────────────────────────────────────────────

let _stockMap: PageMap | null = null

/** 종목 DB의 종목명/종목코드 → pageId 맵 (캐싱) */
export async function getStockMap(): Promise<PageMap> {
  if (_stockMap) return _stockMap
  if (!env.STOCK_DB_ID) return new Map()

  console.log("  📋 종목 DB 페이지 맵 로드 중...")
  _stockMap = await buildPageMap(env.STOCK_DB_ID)
  console.log(`    → ${_stockMap.size}개 종목 로드됨`)
  return _stockMap
}

// ─── 크롤링 데이터에 링크 매핑 ─────────────────────────────────

/**
 * 크롤링 데이터의 테마/종목에 notionPageId를 매핑합니다.
 */
export async function enrichWithLinks(
  data: DailyMarketData
): Promise<DailyMarketData> {
  const themeMap = await getThemeMap()
  const stockMap = await getStockMap()

  let themeMatched = 0
  let themeFuzzyMatched = 0
  let stockMatched = 0

  // 테마 매칭
  for (const theme of data.hotThemes) {
    // 1) exact match
    let pageId = themeMap.get(theme.name)
    if (pageId) {
      theme.notionPageId = pageId
      themeMatched++
    } else {
      // 2) fuzzy match
      pageId = fuzzyMatchTheme(theme.name, themeMap)
      if (pageId) {
        theme.notionPageId = pageId
        themeFuzzyMatched++
      }
    }

    // 테마 내 종목 매칭 (코드 → 이름 순으로 시도)
    for (const stock of theme.stocks) {
      const id =
        stockMap.get(stock.code.toUpperCase()) || stockMap.get(stock.name)
      if (id) {
        stock.notionPageId = id
        stockMatched++
      }
    }
  }

  // 상한가 종목 매칭
  for (const stock of data.upperLimitStocks) {
    const id =
      stockMap.get(stock.code.toUpperCase()) || stockMap.get(stock.name)
    if (id) {
      stock.notionPageId = id
      stockMatched++
    }
  }

  const hasThemeDb = env.THEME_DB_ID ? "활성" : "미설정"
  const hasStockDb = env.STOCK_DB_ID ? "활성" : "미설정"
  console.log(
    `  🔗 DB 링크 매칭: 테마 ${themeMatched}개 (exact) + ${themeFuzzyMatched}개 (fuzzy), 종목 ${stockMatched}개 (테마DB: ${hasThemeDb}, 종목DB: ${hasStockDb})`
  )

  return data
}
