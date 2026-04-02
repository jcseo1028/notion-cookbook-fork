/**
 * 핀업 테마록 — 강세 테마 및 관련 종목 크롤러
 *
 * API:
 * - ThemeCaptureChart: 테마 랭킹 (상위 30개)
 * - ThemeRelationStock: 테마별 관련 종목
 */

import type { ThemeData, ThemeStock } from "../../types/market-data.js"

const STOCKDATA_API = "https://stockdata.finup.co.kr/api"
const HEADERS = {
  "Content-Type": "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120",
  Referer: "https://finance.finup.co.kr/Lab/ThemeLog",
}

/** 핀업 API 공통 POST 요청 */
async function finupPost<T>(
  endpoint: string,
  body: Record<string, any>
): Promise<T> {
  const res = await fetch(`${STOCKDATA_API}${endpoint}`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`finup API ${endpoint} error: ${res.status}`)
  return res.json() as Promise<T>
}

/** ThemeCaptureChart 응답 타입 */
interface ThemeCaptureItem {
  KeywordIdx: number
  Keyword: string
  Diff: number // 등락률
  Score: number
  Percentage: number
  CaptureItemIdx: number
  CaptureDT: string
  Rank: number
  New: number
  Hot: number
}

/** ThemeRelationStock 응답 타입 */
interface RelationStockItem {
  KeywordIdx: number
  Keyword: string // 종목명
  StockCode: string // 종목코드 6자리
  Diff: number // 등락률
  Price: number // 현재가
  Volume: number // 거래량
  ValueSum: number
  MarketCap: number // 시가총액
  Except: boolean
  TypeStock: number
}

// ─── 공개 API ──────────────────────────────────────────────────

/**
 * 핀업 테마록 강세 테마 + 관련 종목을 크롤링합니다.
 * @param topN 상위 N개 테마만 가져옴 (기본 20)
 * @param fetchStocks 관련 종목도 가져올지 (기본 true)
 */
export async function crawlHotThemes(
  topN: number = 20,
  fetchStocks: boolean = true
): Promise<ThemeData[]> {
  console.log("  📡 핀업 테마록 크롤링 중...")

  // 1) 테마 랭킹 조회
  const themes = await finupPost<ThemeCaptureItem[]>("/ThemeCaptureChart", {
    CaptureIdx: "",
  })

  const topThemes = themes.slice(0, topN)
  console.log(`    테마 ${themes.length}개 중 상위 ${topThemes.length}개 선택`)

  // 2) 각 테마의 관련 종목 조회 (선택적)
  const results: ThemeData[] = []

  for (const theme of topThemes) {
    let stocks: ThemeStock[] = []

    if (fetchStocks) {
      try {
        const rawStocks = await finupPost<RelationStockItem[]>(
          "/ThemeRelationStock",
          {
            CaptureIdx: theme.CaptureItemIdx || "",
            KeywordIdx: theme.KeywordIdx,
          }
        )

        stocks = rawStocks
          .filter((s) => !s.Except)
          .map((s) => ({
            code: s.StockCode,
            name: s.Keyword,
            changeRate: s.Diff,
            price: s.Price,
            volume: s.Volume,
            marketCap: s.MarketCap,
          }))
      } catch {
        // 종목 조회 실패 시 빈 배열로 진행
      }
    }

    results.push({
      name: theme.Keyword,
      changeRate: theme.Diff,
      score: theme.Score,
      stocks,
    })
  }

  // 콘솔 출력
  for (const theme of results.slice(0, 10)) {
    const arrow = theme.changeRate >= 0 ? "+" : ""
    console.log(
      `    ${theme.name} (${arrow}${theme.changeRate.toFixed(2)}%) score=${theme.score} 종목=${theme.stocks.length}개`
    )
  }
  if (results.length > 10) {
    console.log(`    ... 외 ${results.length - 10}개`)
  }

  return results
}

/**
 * 핀업 테마록의 CaptureItemIdx (타임스탬프) 를 반환합니다.
 * 스크린샷 캡처 시 최신 데이터 시점 확인용
 */
export async function getLatestCaptureIdx(): Promise<number> {
  const themes = await finupPost<ThemeCaptureItem[]>("/ThemeCaptureChart", {
    CaptureIdx: "",
  })
  return themes[0]?.CaptureItemIdx || 0
}
