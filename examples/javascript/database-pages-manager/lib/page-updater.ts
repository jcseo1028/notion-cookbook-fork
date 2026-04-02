/**
 * Phase 2: 크롤링 데이터 → Notion 페이지 블록 자동 입력
 *
 * 오늘 "장마감 정리" 페이지의 각 섹션(heading_3)을 찾아
 * 크롤링 데이터를 블록으로 변환하여 삽입합니다.
 */

import {
  notion,
  fetchAllBlocks,
  type BlockWithDepth,
  type BlockObjectResponse,
} from "./notion-client.js"
import type {
  DailyMarketData,
  IndexData,
  UpperLimitStock,
  ThemeData,
} from "../types/market-data.js"

// ─── Notion 블록 빌더 ──────────────────────────────────────────

type RichTextItem = {
  type: "text"
  text: { content: string; link?: { url: string } | null }
  annotations?: Record<string, any>
}

type MentionItem = {
  type: "mention"
  mention: { type: "page"; page: { id: string } }
  annotations?: Record<string, any>
}

type RichText = RichTextItem | MentionItem

function text(content: string, bold = false): RichTextItem {
  return {
    type: "text",
    text: { content, link: null },
    ...(bold ? { annotations: { bold: true } } : {}),
  }
}

function mention(pageId: string): MentionItem {
  return {
    type: "mention",
    mention: { type: "page", page: { id: pageId } },
  }
}

function paragraphBlock(richText: RichText[]) {
  return {
    type: "paragraph" as const,
    paragraph: { rich_text: richText },
  }
}

function bulletBlock(richText: RichText[]) {
  return {
    type: "bulleted_list_item" as const,
    bulleted_list_item: { rich_text: richText },
  }
}

function imageBlock(url: string, caption: string = "") {
  return {
    type: "image" as const,
    image: {
      type: "external" as const,
      external: { url },
      ...(caption
        ? { caption: [{ type: "text" as const, text: { content: caption } }] }
        : {}),
    },
  }
}

function fileUploadBlock(fileUploadId: string, caption: string = "") {
  return {
    type: "image" as const,
    image: {
      type: "file_upload" as const,
      file_upload: { id: fileUploadId },
      ...(caption
        ? { caption: [{ type: "text" as const, text: { content: caption } }] }
        : {}),
    },
  }
}

// ─── 섹션 탐색 ─────────────────────────────────────────────────

interface SectionInfo {
  headingBlockId: string
  afterBlockId: string // heading 다음 첫 블록 (여기에 after 삽입)
  emptyBlockIds: string[] // 삭제할 빈 블록들
}

/**
 * 페이지에서 특정 텍스트를 포함하는 heading_3 섹션을 찾습니다.
 * 해당 heading과 다음 heading/divider 사이의 빈 블록들을 반환합니다.
 */
function findSection(
  blocks: BlockWithDepth[],
  sectionKeyword: string
): SectionInfo | null {
  let headingIdx = -1

  // 최상위 블록(depth=0)에서만 검색
  const topBlocks = blocks.filter((b) => b.depth === 0)

  for (let i = 0; i < topBlocks.length; i++) {
    const { block } = topBlocks[i]
    if (block.type === "heading_3") {
      const headingText = (block as any).heading_3?.rich_text
        ?.map((t: any) => t.plain_text)
        .join("")
      if (headingText?.includes(sectionKeyword)) {
        headingIdx = i
        break
      }
    }
  }

  if (headingIdx < 0) return null

  const headingBlock = topBlocks[headingIdx].block

  // heading 다음 블록부터 다음 heading/divider 전까지 빈 블록 수집
  const emptyBlockIds: string[] = []
  let afterBlockId = headingBlock.id

  for (let i = headingIdx + 1; i < topBlocks.length; i++) {
    const { block } = topBlocks[i]
    // 다음 heading 또는 divider 만나면 중단
    if (block.type.startsWith("heading_") || block.type === "divider") {
      break
    }
    // 빈 paragraph/bullet 블록은 삭제 대상
    const blockText = (block as any)[block.type!]?.rich_text
      ?.map((t: any) => t.plain_text)
      .join("")
      .trim()
    if (!blockText || blockText === "") {
      emptyBlockIds.push(block.id)
    }
    afterBlockId = block.id
  }

  return {
    headingBlockId: headingBlock.id,
    afterBlockId,
    emptyBlockIds,
  }
}

// ─── 데이터 → 블록 변환 ────────────────────────────────────────

/** 지수 데이터 → bulleted_list 블록 */
function buildIndexBlocks(
  worldIndices: IndexData[],
  domesticIndices: IndexData[]
): any[] {
  const allIndices = [...worldIndices, ...domesticIndices]
  return allIndices.map((idx) => {
    const arrow = idx.change >= 0 ? "▲" : "▼"
    const sign = idx.changeRate >= 0 ? "+" : ""
    const content = `${idx.name} : ${idx.value.toLocaleString()} , ${arrow} ${Math.abs(idx.change).toFixed(2)} (${sign}${idx.changeRate.toFixed(2)}%)`
    return bulletBlock([text(content)])
  })
}

/** 상한가 종목 → 블록 (코스피/코스닥 분리) */
function buildUpperBlocks(stocks: UpperLimitStock[]): any[] {
  const kospi = stocks.filter((s) => s.market === "코스피")
  const kosdaq = stocks.filter((s) => s.market === "코스닥")
  const blocks: any[] = []

  if (kospi.length > 0) {
    blocks.push(paragraphBlock([text(`코스피 (${kospi.length}개)`, true)]))
    for (const s of kospi) {
      blocks.push(buildStockBullet(s))
    }
  }

  if (kosdaq.length > 0) {
    blocks.push(paragraphBlock([text(`코스닥 (${kosdaq.length}개)`, true)]))
    for (const s of kosdaq) {
      blocks.push(buildStockBullet(s))
    }
  }

  return blocks
}

/** 종목 → bullet 블록 (DB 링크 있으면 mention) */
function buildStockBullet(s: {
  name: string
  code: string
  price: number
  changeRate: number
  notionPageId?: string
}) {
  const suffix = ` (${s.code}) ${s.price.toLocaleString()}원 ${s.changeRate >= 0 ? "+" : ""}${s.changeRate.toFixed(2)}%`
  if (s.notionPageId) {
    return bulletBlock([mention(s.notionPageId), text(suffix)])
  }
  return bulletBlock([text(`${s.name}${suffix}`)])
}

/** 강세 테마 → 블록 (15% 이상만, 하위에 15%↑ 종목 포함) */
const THEME_MIN_RATE = 15 // 문서에 추가할 최소 테마 상승률 (%)
const STOCK_MIN_RATE = 15 // 테마 하위에 추가할 최소 종목 상승률 (%)

function buildThemeBlocks(themes: ThemeData[]): any[] {
  const blocks: any[] = []

  // 상승률 15% 이상 테마만 필터
  const qualified = themes.filter((t) => t.changeRate >= THEME_MIN_RATE)

  for (const theme of qualified) {
    const arrow = theme.changeRate >= 0 ? "+" : ""
    const scoreStr = theme.score ? ` score=${theme.score}` : ""

    // 테마명 rich_text
    const themeRichText: RichText[] = theme.notionPageId
      ? [
          mention(theme.notionPageId),
          text(` (${arrow}${theme.changeRate.toFixed(2)}%)${scoreStr}`),
        ]
      : [
          text(
            `${theme.name} (${arrow}${theme.changeRate.toFixed(2)}%)${scoreStr}`
          ),
        ]

    // 테마 내 15%↑ 종목을 child 블록으로 구성
    const qualifiedStocks = theme.stocks.filter(
      (s) => s.changeRate >= STOCK_MIN_RATE
    )
    const childBlocks = qualifiedStocks.map((s) => {
      const suffix = ` (${s.code}) ${s.price.toLocaleString()}원 ${s.changeRate >= 0 ? "+" : ""}${s.changeRate.toFixed(2)}%`
      if (s.notionPageId) {
        return bulletBlock([mention(s.notionPageId), text(suffix)])
      }
      return bulletBlock([text(`${s.name}${suffix}`)])
    })

    if (childBlocks.length > 0) {
      // children이 있는 bullet
      blocks.push({
        type: "bulleted_list_item" as const,
        bulleted_list_item: {
          rich_text: themeRichText,
          children: childBlocks,
        },
      })
    } else {
      blocks.push(bulletBlock(themeRichText))
    }
  }

  return blocks
}

// ─── 블록 삽입 유틸 ─────────────────────────────────────────────

/** heading의 자식으로 블록 추가 (after 지정) */
async function appendBlocksAfter(
  parentId: string,
  afterBlockId: string,
  blocks: any[]
): Promise<void> {
  if (blocks.length === 0) return

  // Notion API는 한 번에 최대 100개 블록
  const batchSize = 100
  let currentAfter = afterBlockId

  for (let i = 0; i < blocks.length; i += batchSize) {
    const batch = blocks.slice(i, i + batchSize)
    const response = await notion.blocks.children.append({
      block_id: parentId,
      children: batch,
      after: currentAfter,
    })
    // 다음 배치는 마지막으로 추가된 블록 뒤에
    if (response.results.length > 0) {
      currentAfter = response.results[response.results.length - 1].id
    }
  }
}

/** 빈 블록 삭제 */
async function deleteBlocks(blockIds: string[]): Promise<void> {
  for (const id of blockIds) {
    try {
      await notion.blocks.delete({ block_id: id })
    } catch {
      // 이미 삭제되었거나 권한이 없을 수 있음
    }
  }
}

// ─── 메인: 페이지 업데이트 ──────────────────────────────────────

/**
 * 크롤링 데이터를 오늘 "장마감 정리" 페이지에 자동 입력합니다.
 */
export async function updatePageWithMarketData(
  pageId: string,
  data: DailyMarketData
): Promise<void> {
  console.log("\n📝 페이지에 시황 데이터 입력 중...")

  // 1) 페이지의 현재 블록 구조 조회
  const blocks = await fetchAllBlocks(pageId, 0, 1) // depth 1까지만
  console.log(`  → 기존 블록 ${blocks.length}개 조회`)

  let updatedSections = 0

  // 2) 국내외 시장 지수 섹션
  if (data.worldIndices.length > 0 || data.domesticIndices.length > 0) {
    const section = findSection(blocks, "국내외 시장 지수")
    if (section) {
      // 기존 빈 블록 삭제
      await deleteBlocks(section.emptyBlockIds)

      // 지수 블록 삽입
      const indexBlocks = buildIndexBlocks(
        data.worldIndices,
        data.domesticIndices
      )
      await appendBlocksAfter(pageId, section.headingBlockId, indexBlocks)
      console.log(`  ✅ 지수 데이터 ${indexBlocks.length}개 블록 삽입`)
      updatedSections++
    } else {
      console.log("  ⚠️ '국내외 시장 지수' 섹션을 찾을 수 없습니다")
    }
  }

  // 3) 주요 테마 섹션
  if (data.hotThemes.length > 0) {
    const section = findSection(blocks, "주요 테마")
    if (section) {
      await deleteBlocks(section.emptyBlockIds)

      const themeBlocks: any[] = []

      // 테마록 스크린샷 이미지 (Notion file upload)
      if (data.themeTableFileUploadId) {
        themeBlocks.push(
          fileUploadBlock(
            data.themeTableFileUploadId,
            `핀업 테마록 (${data.date})`
          )
        )
      }

      // 15%↑ 테마 리스트 + 하위 15%↑ 종목
      const filteredBlocks = buildThemeBlocks(data.hotThemes)
      themeBlocks.push(...filteredBlocks)

      const qualifiedCount = data.hotThemes.filter(
        (t) => t.changeRate >= THEME_MIN_RATE
      ).length

      await appendBlocksAfter(pageId, section.headingBlockId, themeBlocks)
      console.log(
        `  ✅ 테마 데이터: 전체 ${data.hotThemes.length}개 중 15%↑ ${qualifiedCount}개 테마 (${themeBlocks.length}개 블록) 삽입`
      )
      updatedSections++
    } else {
      console.log("  ⚠️ '주요 테마' 섹션을 찾을 수 없습니다")
    }
  }

  // 4) 상한가 섹션
  if (data.upperLimitStocks.length > 0) {
    const section = findSection(blocks, "의 상한가")
    if (section) {
      await deleteBlocks(section.emptyBlockIds)

      const upperBlocks = buildUpperBlocks(data.upperLimitStocks)
      await appendBlocksAfter(pageId, section.headingBlockId, upperBlocks)
      console.log(`  ✅ 상한가 데이터 ${upperBlocks.length}개 블록 삽입`)
      updatedSections++
    } else {
      console.log("  ⚠️ '의 상한가' 섹션을 찾을 수 없습니다")
    }
  }

  console.log(`\n📊 총 ${updatedSections}개 섹션 업데이트 완료`)
}
