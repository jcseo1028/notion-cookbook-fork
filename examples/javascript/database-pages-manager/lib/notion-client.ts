/**
 * Notion SDK 초기화 및 공용 유틸리티
 *
 * 모든 모듈에서 import { notion, env } from "./lib/notion-client.js" 으로 사용
 */

import {
  Client,
  isFullDatabase,
  isFullPage,
  isFullBlock,
  iteratePaginatedAPI,
} from "@notionhq/client"
import type {
  PageObjectResponse,
  BlockObjectResponse,
} from "@notionhq/client/build/src/api-endpoints"
import { config } from "dotenv"

config()

// ─── 환경 변수 ──────────────────────────────────────────────────
export const env = {
  NOTION_KEY: process.env["NOTION_KEY"] ?? "",
  DATABASE_ID: process.env["NOTION_DATABASE_ID"] ?? "",
  TEMPLATE_PAGE_ID: process.env["NOTION_TEMPLATE_PAGE_ID"] ?? "",
  THEME_DB_ID: process.env["NOTION_THEME_DB_ID"] ?? "",
  STOCK_DB_ID: process.env["NOTION_STOCK_DB_ID"] ?? "",
}

export function validateEnv(...required: (keyof typeof env)[]) {
  const missing = required.filter((k) => !env[k])
  if (missing.length > 0) {
    console.error(
      `❌ 필수 환경변수가 설정되지 않았습니다: ${missing.join(", ")}`
    )
    console.error("   .env 파일을 확인해 주세요.")
    process.exit(1)
  }
}

// ─── Notion Client ──────────────────────────────────────────────
export const notion = new Client({ auth: env.NOTION_KEY || "dummy" })

// ─── 공용 유틸 ──────────────────────────────────────────────────

/** Database ID → Data Source ID 변환 */
export async function getDataSourceId(databaseId: string): Promise<string> {
  const database = await notion.databases.retrieve({ database_id: databaseId })

  if (!isFullDatabase(database)) {
    throw new Error(`데이터베이스에 접근할 수 없습니다: ${databaseId}`)
  }

  const dataSourceId = database.data_sources?.[0]?.id
  if (!dataSourceId) {
    throw new Error(`데이터베이스의 data_source_id를 찾을 수 없습니다.`)
  }

  const title = database.title.map((t) => t.plain_text).join("")
  return dataSourceId
}

/** 페이지 제목 추출 */
export function getPageTitle(page: PageObjectResponse): string {
  for (const [, prop] of Object.entries(page.properties)) {
    if (prop.type === "title" && prop.title.length > 0) {
      return prop.title.map((t) => t.plain_text).join("")
    }
  }
  return "(제목 없음)"
}

/** 블록 + 깊이 정보 */
export interface BlockWithDepth {
  block: BlockObjectResponse
  depth: number
}

/**
 * 페이지/블록의 모든 자식 블록을 재귀적으로 가져옵니다.
 */
export async function fetchAllBlocks(
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

    if (block.has_children && depth < maxDepth) {
      const children = await fetchAllBlocks(block.id, depth + 1, maxDepth)
      result.push(...children)
    }
  }

  return result
}

export { isFullPage, isFullDatabase, isFullBlock, iteratePaginatedAPI }
export type { PageObjectResponse, BlockObjectResponse }
