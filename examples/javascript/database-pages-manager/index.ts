/**
 * Database Pages Manager
 *
 * 1. 특정 Notion DB에 포함된 페이지 목록을 조회하여 출력합니다.
 * 2. (추후 구현) 특정 페이지를 자동으로 수정합니다.
 *
 * Notion SDK v5 — dataSources API를 사용합니다.
 */

import { Client, isFullPage, isFullDatabase } from "@notionhq/client"
import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints"

import { config } from "dotenv"
config()

// ─── 환경 변수 검증 ──────────────────────────────────────────────
const NOTION_KEY = process.env["NOTION_KEY"]
const DATABASE_ID = process.env["NOTION_DATABASE_ID"]

if (!NOTION_KEY || !DATABASE_ID) {
  console.error(
    "❌ NOTION_KEY 와 NOTION_DATABASE_ID 를 .env 파일에 설정해주세요."
  )
  console.error("   example.env 를 .env 로 복사한 뒤 값을 채워주세요.")
  process.exit(1)
}

const notion = new Client({ auth: NOTION_KEY })

// ─── 유틸: Database ID → Data Source ID 변환 ─────────────────────
async function getDataSourceId(databaseId: string): Promise<string> {
  // 먼저 database로 시도
  try {
    const database = await notion.databases.retrieve({
      database_id: databaseId,
    })

    if (!isFullDatabase(database)) {
      throw new Error(`데이터베이스에 접근할 수 없습니다: ${databaseId}`)
    }

    const dataSourceId = database.data_sources?.[0]?.id
    if (!dataSourceId) {
      throw new Error(`데이터베이스의 data_source_id를 찾을 수 없습니다.`)
    }

    console.log(
      `  Database: ${database.title.map((t) => t.plain_text).join("")}`
    )
    console.log(`  Data Source ID: ${dataSourceId}`)

    return dataSourceId
  } catch (e) {
    // database가 아니면 page로 시도 — 인라인 DB가 포함된 페이지일 수 있음
    console.log(`  ⚠️  ID가 데이터베이스가 아닙니다. 페이지로 시도합니다...`)
    try {
      const page = await notion.pages.retrieve({ page_id: databaseId })
      console.log(`  ✅ 이 ID는 페이지입니다. (object: ${page.object})`)
      console.log(`     URL: ${"url" in page ? page.url : "N/A"}`)
      console.log(`\n  💡 해결 방법:`)
      console.log(`     Notion에서 데이터베이스 표 영역의 ··· → "링크 복사"로`)
      console.log(`     데이터베이스 자체의 ID를 가져와 .env에 설정해 주세요.`)
      process.exit(1)
    } catch {
      throw new Error(
        `ID '${databaseId}'에 해당하는 데이터베이스 또는 페이지를 찾을 수 없습니다.\n` +
          `  → Integration이 해당 페이지에 연결되어 있는지 확인하세요.\n` +
          `  → Database ID가 올바른지 확인하세요.`
      )
    }
  }
}

// ─── 유틸: 페이지 제목 추출 ──────────────────────────────────────
function getPageTitle(page: PageObjectResponse): string {
  const props = page.properties

  for (const [, prop] of Object.entries(props)) {
    if (prop.type === "title" && prop.title.length > 0) {
      return prop.title.map((t) => t.plain_text).join("")
    }
  }
  return "(제목 없음)"
}

// ─── 1) DB 내 최신 페이지 목록 조회 ─────────────────────────────
async function listPagesInDatabase(dataSourceId: string, limit: number = 10) {
  console.log(`\n📋 최신 ${limit}개 페이지 조회 중...\n`)

  const pages: PageObjectResponse[] = []

  const response = await notion.dataSources.query({
    data_source_id: dataSourceId,
    sorts: [{ timestamp: "created_time", direction: "descending" }],
    page_size: limit,
  })

  for (const page of response.results) {
    if (isFullPage(page)) {
      pages.push(page)
    }
  }

  return pages
}

// ─── 2) 페이지 목록 출력 ────────────────────────────────────────
function printPages(pages: PageObjectResponse[]) {
  if (pages.length === 0) {
    console.log("  (데이터베이스에 페이지가 없습니다)")
    return
  }

  console.log(`  총 ${pages.length}개 페이지를 찾았습니다.\n`)
  console.log("  ─────────────────────────────────────────────────")

  pages.forEach((page, index) => {
    const title = getPageTitle(page)
    const created = new Date(page.created_time).toLocaleDateString("ko-KR")
    const updated = new Date(page.last_edited_time).toLocaleDateString("ko-KR")
    const url = page.url

    console.log(`  ${index + 1}. ${title}`)
    console.log(`     ID: ${page.id}`)
    console.log(`     생성: ${created} | 수정: ${updated}`)
    console.log(`     URL: ${url}`)
    console.log("  ─────────────────────────────────────────────────")
  })
}

// ─── 3) (TODO) 특정 페이지 자동 수정 ───────────────────────────
// async function updatePage(pageId: string, properties: Record<string, unknown>) {
//   // 추후 구현 예정
//   // const response = await notion.pages.update({
//   //   page_id: pageId,
//   //   properties: { ... },
//   // })
//   // return response
// }

// ─── 메인 실행 ──────────────────────────────────────────────────
async function main() {
  try {
    console.log("🚀 Database Pages Manager")
    console.log("=".repeat(55))

    // 0. Database ID → Data Source ID 변환
    const dataSourceId = await getDataSourceId(DATABASE_ID)

    // 1. 페이지 목록 조회 및 출력
    const pages = await listPagesInDatabase(dataSourceId)
    printPages(pages)

    // 2. (추후) 페이지 자동 수정
    // 예: 특정 조건의 페이지를 찾아서 프로퍼티를 업데이트
    // const targetPage = pages.find(p => getPageTitle(p).includes("특정 키워드"))
    // if (targetPage) {
    //   await updatePage(targetPage.id, { ... })
    // }

    console.log("\n✅ 완료!")
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error(`\n❌ 오류 발생: ${error.message}`)
    } else {
      console.error("\n❌ 알 수 없는 오류가 발생했습니다.", error)
    }
    process.exit(1)
  }
}

main()
