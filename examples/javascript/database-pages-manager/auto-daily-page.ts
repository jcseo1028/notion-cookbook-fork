/**
 * auto-daily-page.ts — 장마감 정리 페이지 자동화 메인 스크립트
 *
 * Phase 1: 오늘 날짜의 "장마감 정리" 페이지 자동 생성
 * Phase 2: (추후) 시황 데이터 크롤링 & 자동 입력
 *
 * 사용법:
 *   npm run auto                   # 전체 자동화 (생성 + 데이터 입력)
 *   npm run auto -- --create-only  # 페이지 생성만
 *   npm run auto -- --dry-run      # 확인만 (생성/수정 안 함)
 *   npm run auto -- --date 2026-04-01  # 특정 날짜로 실행
 */

import {
  env,
  validateEnv,
  getDataSourceId,
  getPageTitle,
} from "./lib/notion-client.js"
import {
  ensureTodayPage,
  findTodayPage,
  todayString,
} from "./lib/page-creator.js"
import {
  crawlWorldIndices,
  crawlDomesticIndices,
} from "./lib/crawlers/naver-market.js"
import { crawlUpperLimitStocks } from "./lib/crawlers/naver-upper.js"
import { crawlHotThemes } from "./lib/crawlers/finup-theme.js"
import { captureThemeTable, uploadImageToNotion } from "./lib/screenshot.js"
import { enrichWithLinks } from "./lib/db-linker.js"
import { updatePageWithMarketData } from "./lib/page-updater.js"
import type { DailyMarketData } from "./types/market-data.js"
import { join } from "path"

// ─── CLI 인자 파싱 ──────────────────────────────────────────────

interface CliOptions {
  createOnly: boolean
  crawlOnly: boolean
  dryRun: boolean
  date: string
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2)
  const opts: CliOptions = {
    createOnly: false,
    crawlOnly: false,
    dryRun: false,
    date: todayString(),
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--create-only":
        opts.createOnly = true
        break
      case "--crawl-only":
        opts.crawlOnly = true
        break
      case "--dry-run":
        opts.dryRun = true
        break
      case "--date":
        if (args[i + 1] && /^\d{4}-\d{2}-\d{2}$/.test(args[i + 1])) {
          opts.date = args[++i]
        } else {
          console.error(
            "❌ --date 뒤에 YYYY-MM-DD 형식의 날짜를 지정해 주세요."
          )
          process.exit(1)
        }
        break
    }
  }

  return opts
}

// ─── 메인 ───────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs()

  console.log("🚀 장마감 정리 페이지 자동화")
  console.log("=".repeat(55))
  console.log(`  날짜: ${opts.date}`)
  console.log(
    `  모드: ${opts.dryRun ? "DRY-RUN (확인만)" : opts.createOnly ? "생성만" : opts.crawlOnly ? "크롤링만" : "전체"}`
  )

  // 환경변수 검증
  validateEnv("NOTION_KEY", "DATABASE_ID")

  // 0. Database ID → Data Source ID
  console.log(`\n📊 데이터베이스 연결 중...`)
  const dataSourceId = await getDataSourceId(env.DATABASE_ID)
  console.log(`  ✅ Data Source 연결 완료`)

  // ─────────────────────────────────────────────────────
  // Phase 1: 오늘 페이지 확보
  // ─────────────────────────────────────────────────────

  if (!opts.crawlOnly) {
    if (opts.dryRun) {
      // dry-run: 존재 여부만 확인
      const { findTodayPage } = await import("./lib/page-creator.js")
      const existing = await findTodayPage(dataSourceId, opts.date)
      if (existing) {
        console.log(`\n✅ [DRY-RUN] 페이지 존재: ${getPageTitle(existing)}`)
        console.log(`   URL: ${existing.url}`)
      } else {
        console.log(
          `\nℹ️  [DRY-RUN] "${opts.date} 장마감 정리" 페이지가 없습니다.`
        )
        console.log(`   실제 실행 시 템플릿에서 생성됩니다.`)
      }
    } else {
      // 실제 실행: 페이지 확보 (있으면 재사용, 없으면 생성)
      const { page, created } = await ensureTodayPage(
        dataSourceId,
        env.DATABASE_ID,
        opts.date,
        env.TEMPLATE_PAGE_ID || undefined
      )

      if (created) {
        console.log(`\n🎉 새 페이지가 생성되었습니다!`)
      } else {
        console.log(`\n📄 기존 페이지를 사용합니다.`)
      }
      console.log(`   제목: ${getPageTitle(page)}`)
      console.log(`   URL: ${page.url}`)

      if (opts.createOnly) {
        console.log("\n✅ 페이지 생성 완료! (--create-only)")
        return
      }

      // ─────────────────────────────────────────────────────
      // Phase 2: 시황 데이터 크롤링 & 자동 입력
      // ─────────────────────────────────────────────────────

      await runPhase2(page.id, opts.date, opts.dryRun)
    }
  } else {
    // --crawl-only: 기존 페이지를 찾아서 크롤링 데이터만 입력
    console.log(`\n🔍 "${opts.date} 장마감 정리" 페이지 검색 중...`)
    const existing = await findTodayPage(dataSourceId, opts.date)
    if (!existing) {
      console.error(
        `\n❌ "${opts.date}" 페이지를 찾을 수 없습니다. --crawl-only는 기존 페이지가 필요합니다.`
      )
      process.exit(1)
    }
    console.log(`  ✅ 기존 페이지: ${getPageTitle(existing)}`)
    console.log(`     URL: ${existing.url}`)

    await runPhase2(existing.id, opts.date, opts.dryRun)
  }

  console.log("\n✅ 완료!")
}

// ─── Phase 2: 크롤링 & 입력 ────────────────────────────────────

async function runPhase2(
  pageId: string,
  dateStr: string,
  dryRun: boolean
): Promise<void> {
  console.log("\n" + "─".repeat(55))
  console.log("📊 Phase 2: 시황 데이터 크롤링")
  console.log("─".repeat(55))

  // 1) 병렬 크롤링
  const [worldIndices, domesticIndices, upperLimitStocks, hotThemes] =
    await Promise.all([
      crawlWorldIndices().catch((e) => {
        console.error("  ❌ 해외지수 크롤링 실패:", e.message)
        return []
      }),
      crawlDomesticIndices().catch((e) => {
        console.error("  ❌ 국내지수 크롤링 실패:", e.message)
        return []
      }),
      crawlUpperLimitStocks().catch((e) => {
        console.error("  ❌ 상한가 크롤링 실패:", e.message)
        return []
      }),
      crawlHotThemes(30, true).catch((e) => {
        console.error("  ❌ 테마 크롤링 실패:", e.message)
        return []
      }),
    ])

  // 2) 테마록 스크린샷 캡처 & Notion 업로드
  let themeTableFileUploadId: string | undefined
  try {
    const screenshotPath = join("tmp", `theme-table-${dateStr}.jpg`)
    await captureThemeTable(screenshotPath)
    themeTableFileUploadId = await uploadImageToNotion(screenshotPath)
  } catch (e: any) {
    console.warn(`  ⚠️ 테마록 스크린샷 캡처/업로드 실패: ${e.message}`)
  }

  // 3) 크롤링 결과 조합
  let marketData: DailyMarketData = {
    date: dateStr,
    worldIndices,
    domesticIndices,
    upperLimitStocks,
    hotThemes,
    themeTableFileUploadId,
  }

  // 4) DB 링크 매핑 (테마/종목 DB가 설정된 경우)
  if (env.THEME_DB_ID || env.STOCK_DB_ID) {
    try {
      marketData = await enrichWithLinks(marketData)
    } catch (e: any) {
      console.warn("  ⚠️ DB 링크 매핑 실패:", e.message)
    }
  }

  // 5) 크롤링 결과 요약
  console.log("\n📋 크롤링 결과 요약:")
  console.log(`  해외지수: ${worldIndices.length}개`)
  console.log(`  국내지수: ${domesticIndices.length}개`)
  console.log(`  상한가: ${upperLimitStocks.length}개`)
  console.log(`  테마: ${hotThemes.length}개`)

  // 6) 페이지에 데이터 입력
  if (dryRun) {
    console.log("\n🏃 [DRY-RUN] 크롤링 완료 — Notion 페이지 수정은 건너뜁니다.")
  } else {
    await updatePageWithMarketData(pageId, marketData)
  }
}

main().catch((error) => {
  if (error instanceof Error) {
    console.error(`\n❌ 오류 발생: ${error.message}`)
  } else {
    console.error("\n❌ 알 수 없는 오류가 발생했습니다.", error)
  }
  process.exit(1)
})
