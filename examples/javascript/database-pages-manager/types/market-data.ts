/**
 * 시황 데이터 타입 정의
 */

/** 지수 데이터 (해외/국내) */
export interface IndexData {
  name: string // "나스닥" | "S&P500" | "다우" | "KOSPI" | "KOSDAQ"
  value: number // 현재 지수
  change: number // 등락폭
  changeRate: number // 등락률 (%)
}

/** 상한가 종목 */
export interface UpperLimitStock {
  market: "코스피" | "코스닥"
  code: string // 종목코드 (6자리)
  name: string // 종목명
  price: number // 현재가
  changeRate: number // 등락률
  volume: number // 거래량
  notionPageId?: string // 종목 DB 매칭 시
}

/** 테마 소속 종목 */
export interface ThemeStock {
  code: string
  name: string
  changeRate: number
  price: number
  volume: number
  marketCap: number
  notionPageId?: string
}

/** 강세 테마 */
export interface ThemeData {
  name: string // 테마명
  changeRate: number // 테마 등락률
  score: number // 스코어
  notionPageId?: string // 테마 DB 매칭 시
  stocks: ThemeStock[]
}

/** 하루 전체 시황 데이터 */
export interface DailyMarketData {
  date: string
  worldIndices: IndexData[]
  domesticIndices: IndexData[]
  upperLimitStocks: UpperLimitStock[]
  hotThemes: ThemeData[]
  themeTableImagePath?: string // 핀업 테마록 스크린샷 경로
  themeTableFileUploadId?: string // Notion file upload ID (스크린샷)
}
