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
        map.set(title, page.id)
        // 종목 DB의 경우 종목코드(6자리)도 별도 키로 추가
        const codeMatch = title.match(/\((\d{6})\)/)
        if (codeMatch) {
          map.set(codeMatch[1], page.id)
        }
      }
      total++
    }

    if (!response.has_more || !response.next_cursor) break
    cursor = response.next_cursor
  }

  return map
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
  let stockMatched = 0

  // 테마 매칭
  for (const theme of data.hotThemes) {
    const pageId = themeMap.get(theme.name)
    if (pageId) {
      theme.notionPageId = pageId
      themeMatched++
    }

    // 테마 내 종목 매칭
    for (const stock of theme.stocks) {
      const id = stockMap.get(stock.code) || stockMap.get(stock.name)
      if (id) {
        stock.notionPageId = id
        stockMatched++
      }
    }
  }

  // 상한가 종목 매칭
  for (const stock of data.upperLimitStocks) {
    const id = stockMap.get(stock.code) || stockMap.get(stock.name)
    if (id) {
      stock.notionPageId = id
      stockMatched++
    }
  }

  const hasThemeDb = env.THEME_DB_ID ? "활성" : "미설정"
  const hasStockDb = env.STOCK_DB_ID ? "활성" : "미설정"
  console.log(
    `  🔗 DB 링크 매칭: 테마 ${themeMatched}개, 종목 ${stockMatched}개 (테마DB: ${hasThemeDb}, 종목DB: ${hasStockDb})`
  )

  return data
}
