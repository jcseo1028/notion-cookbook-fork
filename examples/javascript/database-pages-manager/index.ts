/**
 * Database Pages Manager
 *
 * 1. 특정 Notion DB에 포함된 페이지 목록을 조회하여 출력합니다.
 * 2. (추후 구현) 특정 페이지를 자동으로 수정합니다.
 *
 * Notion SDK v5 — dataSources API를 사용합니다.
 */

import {
  Client,
  isFullPage,
  isFullDatabase,
  isFullBlock,
  iteratePaginatedAPI,
} from "@notionhq/client"
import type {
  PageObjectResponse,
  BlockObjectResponse,
} from "@notionhq/client/build/src/api-endpoints"

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

// ─── 3) 페이지 콘텐츠(블록) 조회 ───────────────────────────────
function getTextFromBlock(block: BlockObjectResponse): string {
  const type = block.type
  const value = block[type]

  // rich_text를 지원하는 블록 (paragraph, heading, list 등)
  if (value && "rich_text" in value && Array.isArray(value.rich_text)) {
    const parts = value.rich_text.map((t: any) => {
      // page mention이 "Untitled"인 경우 — 연동되지 않은 다른 DB의 페이지
      if (
        t.type === "mention" &&
        t.mention?.type === "page" &&
        t.plain_text === "Untitled"
      ) {
        return `[🔗 연동 안 된 페이지](${t.href})`
      }
      return t.plain_text
    })
    const text = parts.join("")
    return text || ""
  }

  // 특수 블록 타입
  switch (type) {
    case "image":
      return "[이미지]"
    case "video":
      return "[비디오]"
    case "file":
      return "[파일]"
    case "bookmark":
      return `[북마크] ${(value as any)?.url || ""}`
    case "divider":
      return "───────────────────"
    case "table":
      return "[표]"
    case "child_database":
      return `[하위 DB] ${(value as any)?.title || ""}`
    case "child_page":
      return `[하위 페이지] ${(value as any)?.title || ""}`
    case "equation":
      return `[수식] ${(value as any)?.expression || ""}`
    default:
      return ""
  }
}

function blockTypePrefix(type: string): string {
  const prefixMap: Record<string, string> = {
    heading_1: "# ",
    heading_2: "## ",
    heading_3: "### ",
    bulleted_list_item: "  • ",
    numbered_list_item: "  1. ",
    to_do: "  ☐ ",
    toggle: "  ▸ ",
    quote: "  > ",
    callout: "  💡 ",
    code: "  ```\n  ",
  }
  return prefixMap[type] || "  "
}

/** 블록 + 깊이 정보를 함께 저장하는 타입 */
interface BlockWithDepth {
  block: BlockObjectResponse
  depth: number
}

/**
 * 페이지의 모든 블록을 재귀적으로 가져옵니다.
 * has_children === true 인 블록은 자식 블록도 조회합니다.
 * @param blockId  페이지 ID 또는 부모 블록 ID
 * @param depth    현재 깊이 (0 = 최상위)
 * @param maxDepth 최대 재귀 깊이 (기본 3)
 */
async function fetchPageContent(
  blockId: string,
  depth: number = 0,
  maxDepth: number = 3
): Promise<BlockWithDepth[]> {
  const result: BlockWithDepth[] = []

  for await (const block of iteratePaginatedAPI(notion.blocks.children.list, {
    block_id: blockId,
  })) {
    if (!isFullBlock(block)) continue

    result.push({ block, depth })

    // 자식 블록이 있고, 최대 깊이 미만이면 재귀 조회
    if (block.has_children && depth < maxDepth) {
      const children = await fetchPageContent(block.id, depth + 1, maxDepth)
      result.push(...children)
    }
  }

  return result
}

function printPageContent(title: string, items: BlockWithDepth[]) {
  console.log(`\n📄 페이지 내용: ${title}`)
  console.log("  ═════════════════════════════════════════════════")

  if (items.length === 0) {
    console.log("  (내용 없음)")
    return
  }

  for (const { block, depth } of items) {
    const text = getTextFromBlock(block)
    if (text) {
      const indent = "  ".repeat(depth) // 깊이에 따라 들여쓰기
      const prefix = blockTypePrefix(block.type)
      console.log(`${indent}${prefix}${text}`)
    }
  }

  console.log("  ═════════════════════════════════════════════════")
}

// ─── 4) (TODO) 특정 페이지 자동 수정 ───────────────────────────
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

    // 2. 최신 페이지 내용 보기 (재귀적으로 모든 하위 블록 포함)
    if (pages.length > 0) {
      const latestPage = pages[0]
      const title = getPageTitle(latestPage)
      const blocks = await fetchPageContent(latestPage.id)
      printPageContent(title, blocks)
    }

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
