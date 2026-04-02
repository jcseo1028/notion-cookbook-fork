/**
 * 네이버 금융 — 상한가 종목 크롤러
 *
 * https://finance.naver.com/sise/sise_upper.naver
 * 코스피 / 코스닥 상한가 종목을 파싱합니다.
 */

import * as cheerio from "cheerio"
import type { UpperLimitStock } from "../../types/market-data.js"

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120"

/** EUC-KR 인코딩 페이지를 fetch하여 디코딩 */
async function fetchEucKr(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA } })
  const buf = await res.arrayBuffer()
  return new TextDecoder("euc-kr").decode(buf)
}

/** 문자열에서 숫자 추출 (콤마 제거) */
function toNum(s: string): number {
  return parseFloat(s.replace(/[^0-9.+-]/g, "")) || 0
}

/** 상한가 페이지 테이블을 파싱합니다 */
function parseUpperTable(
  $: cheerio.CheerioAPI,
  tableEl: cheerio.Cheerio<any>,
  market: "코스피" | "코스닥"
): UpperLimitStock[] {
  const stocks: UpperLimitStock[] = []

  tableEl.find("tr").each((_, tr) => {
    const tds = $(tr).find("td")
    if (tds.length < 7) return // 데이터 행이 아님

    const rank = $(tds[0]).text().trim()
    if (!rank || !/^\d+$/.test(rank)) return // 빈 행 skip

    // 종목명 & 종목코드
    const nameLink = $(tds[3]).find("a")
    const name = nameLink.text().trim()
    const href = nameLink.attr("href") || ""
    const codeMatch = href.match(/code=(\d{6})/)
    const code = codeMatch ? codeMatch[1] : ""

    // 현재가
    const price = toNum($(tds[4]).text())

    // 등락률
    const rateText = $(tds[6]).text().trim()
    const changeRate = toNum(rateText)

    // 거래량
    const volume = toNum($(tds[7]).text())

    if (name && price > 0) {
      stocks.push({ market, code, name, price, changeRate, volume })
    }
  })

  return stocks
}

export async function crawlUpperLimitStocks(): Promise<UpperLimitStock[]> {
  console.log("  📡 상한가 종목 크롤링 중...")

  const url = "https://finance.naver.com/sise/sise_upper.naver"
  const html = await fetchEucKr(url)
  const $ = cheerio.load(html)

  const stocks: UpperLimitStock[] = []

  // h4 태그로 코스피/코스닥 구분하여 각각의 table.type_5 파싱
  $("h4.top_tlt").each((_, h4) => {
    const sectionName = $(h4).text().trim()
    const market: "코스피" | "코스닥" = sectionName.includes("코스닥")
      ? "코스닥"
      : "코스피"
    const table = $(h4).next("table.type_5")
    if (table.length) {
      stocks.push(...parseUpperTable($, table, market))
    }
  })

  const kospiCount = stocks.filter((s) => s.market === "코스피").length
  const kosdaqCount = stocks.filter((s) => s.market === "코스닥").length
  console.log(`    코스피 ${kospiCount}개, 코스닥 ${kosdaqCount}개`)

  for (const s of stocks) {
    console.log(
      `    [${s.market}] ${s.name}(${s.code}) ${s.price.toLocaleString()}원 ${s.changeRate >= 0 ? "+" : ""}${s.changeRate.toFixed(2)}%`
    )
  }

  return stocks
}
