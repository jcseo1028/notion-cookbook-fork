/**
 * 네이버 금융 — 국내외 시장 지수 크롤러
 *
 * 해외: 다우, 나스닥, S&P500
 * 국내: KOSPI, KOSDAQ
 */

import * as cheerio from "cheerio"
import type { IndexData } from "../../types/market-data.js"

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120"

// ─── 유틸 ──────────────────────────────────────────────────────

/** EUC-KR 인코딩 페이지를 fetch하여 디코딩 */
async function fetchEucKr(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA } })
  const buf = await res.arrayBuffer()
  return new TextDecoder("euc-kr").decode(buf)
}

/** span.noX 개별 숫자 요소를 조합하여 숫자 문자열 추출 */
function parseDigitSpans(
  $el: cheerio.Cheerio<any>,
  $: cheerio.CheerioAPI
): string {
  let result = ""
  $el.find("span").each((_, span) => {
    const cls = $(span).attr("class") || ""
    const text = $(span).text().trim()
    if (/^no\d$/.test(cls)) {
      result += text
    } else if (cls === "jum") {
      result += "."
    } else if (cls === "shim") {
      result += ","
    }
  })
  return result.replace(/,/g, "")
}

/** 문자열에서 숫자만 추출 (부호, 소수점 포함) */
function toNum(s: string): number {
  const cleaned = s.replace(/[^0-9.+-]/g, "")
  return parseFloat(cleaned) || 0
}

// ─── 해외 지수 ─────────────────────────────────────────────────

interface WorldIndex {
  name: string
  symbol: string
}

const WORLD_INDICES: WorldIndex[] = [
  { name: "나스닥", symbol: "NAS@IXIC" },
  { name: "S&P500", symbol: "SPI@SPX" },
  { name: "다우", symbol: "DJI@DJI" },
]

async function fetchWorldIndex(idx: WorldIndex): Promise<IndexData> {
  const url = `https://finance.naver.com/world/sise.naver?symbol=${idx.symbol}`
  const html = await fetchEucKr(url)
  const $ = cheerio.load(html)

  // 현재 지수: div.rate_info > div.today > p.no_today > em 내의 span.noX 조합
  const noToday = $("p.no_today em").first()
  const value = parseFloat(parseDigitSpans(noToday, $)) || 0

  // 등락폭 & 등락률: p.no_exday 내의 em 요소들
  const exdayEms = $("p.no_exday em")
  let change = 0
  let changeRate = 0

  // 첫 번째 em: 등락폭 (ico up/down 포함)
  if (exdayEms.length >= 1) {
    const changeStr = parseDigitSpans(exdayEms.eq(0), $)
    change = parseFloat(changeStr) || 0
  }
  // 두 번째 em: 등락률 (ico plus/minus + %  포함)
  if (exdayEms.length >= 2) {
    const rateText = exdayEms
      .eq(1)
      .text()
      .replace(/[()%\s]/g, "")
    changeRate = parseFloat(rateText) || 0
  }

  // 방향 감지: 하락이면 음수
  const isDown =
    noToday.hasClass("no_down") || $("p.no_exday .ico.down").length > 0
  if (isDown) {
    change = -Math.abs(change)
    changeRate = -Math.abs(changeRate)
  }

  return { name: idx.name, value, change, changeRate }
}

// ─── 국내 지수 ─────────────────────────────────────────────────

interface DomesticIndex {
  name: string
  code: string // KOSPI, KOSDAQ
}

const DOMESTIC_INDICES: DomesticIndex[] = [
  { name: "KOSPI", code: "KOSPI" },
  { name: "KOSDAQ", code: "KOSDAQ" },
]

async function fetchDomesticIndex(idx: DomesticIndex): Promise<IndexData> {
  const url = `https://finance.naver.com/sise/sise_index.naver?code=${idx.code}`
  const html = await fetchEucKr(url)
  const $ = cheerio.load(html)

  // 현재값: #now_value 또는 p.no_today em 내의 span 조합
  let value = 0
  const nowValueEl = $("#now_value")
  if (nowValueEl.length) {
    value = toNum(nowValueEl.text())
  } else {
    const noToday = $("p.no_today em").first()
    value = parseFloat(parseDigitSpans(noToday, $)) || 0
  }

  // change_value_and_rate 영역에서 등락폭/등락률 추출
  // HTML: <span id="change_value_and_rate"><span>244.65</span> -4.47%...
  const changeHtml = $("#change_value_and_rate").html() || ""
  let change = 0
  let changeRate = 0

  // <span>244.65</span> 에서 등락폭 추출
  const changeMatch = changeHtml.match(/<span>([\d,.]+)<\/span>/)
  if (changeMatch) {
    change = toNum(changeMatch[1])
  }
  // -4.47% 또는 +1.23% 패턴으로 등락률 추출
  const rateMatch = changeHtml.match(/([+-][\d,.]+)%/)
  if (rateMatch) {
    changeRate = toNum(rateMatch[1])
  }

  // 방향 감지: change_value_and_rate 영역의 "하락" 텍스트 또는 부호로 판단
  const changeAreaText = $("#change_value_and_rate").text()
  const isDown = changeAreaText.includes("하락") || changeRate < 0

  if (isDown && change > 0) change = -change
  if (isDown && changeRate > 0) changeRate = -changeRate

  return { name: idx.name, value, change, changeRate }
}

// ─── 공개 API ──────────────────────────────────────────────────

export async function crawlWorldIndices(): Promise<IndexData[]> {
  console.log("  📡 해외지수 크롤링 중...")
  const results = await Promise.all(WORLD_INDICES.map(fetchWorldIndex))
  for (const idx of results) {
    const arrow = idx.change >= 0 ? "▲" : "▼"
    console.log(
      `    ${idx.name}: ${idx.value.toLocaleString()} ${arrow} ${Math.abs(idx.change).toFixed(2)} (${idx.changeRate >= 0 ? "+" : ""}${idx.changeRate.toFixed(2)}%)`
    )
  }
  return results
}

export async function crawlDomesticIndices(): Promise<IndexData[]> {
  console.log("  📡 국내지수 크롤링 중...")
  const results = await Promise.all(DOMESTIC_INDICES.map(fetchDomesticIndex))
  for (const idx of results) {
    const arrow = idx.change >= 0 ? "▲" : "▼"
    console.log(
      `    ${idx.name}: ${idx.value.toLocaleString()} ${arrow} ${Math.abs(idx.change).toFixed(2)} (${idx.changeRate >= 0 ? "+" : ""}${idx.changeRate.toFixed(2)}%)`
    )
  }
  return results
}
