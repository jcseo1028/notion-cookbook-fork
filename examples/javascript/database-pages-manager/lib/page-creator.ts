/**
 * Phase 1: 템플릿 기반 페이지 생성
 *
 * - 오늘 날짜의 "장마감 정리" 페이지 존재 확인
 * - 없으면 템플릿 페이지의 블록 구조를 복제하여 새 페이지 생성
 * - 있으면 기존 페이지 반환
 */

import {
  notion,
  env,
  getDataSourceId,
  getPageTitle,
  fetchAllBlocks,
  isFullPage,
  type PageObjectResponse,
  type BlockObjectResponse,
  type BlockWithDepth,
} from "./notion-client.js"

// ─── 날짜 유틸 ──────────────────────────────────────────────────

/** "YYYY-MM-DD" 형식 */
export function todayString(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

// ─── 1) 오늘 페이지 존재 확인 ───────────────────────────────────

/**
 * DB에서 오늘 날짜의 "장마감 정리" 페이지를 찾습니다.
 * dataSources.query의 filter 호환성 문제를 피하기 위해
 * 최근 페이지를 조회하여 제목으로 매칭합니다.
 * @returns 찾으면 PageObjectResponse, 없으면 null
 */
export async function findTodayPage(
  dataSourceId: string,
  dateStr: string
): Promise<PageObjectResponse | null> {
  const searchTitle = `${dateStr} 장마감 정리`

  // 최근 20개 페이지 조회하여 제목 매칭 (오늘 ± 며칠 내에 있을 것)
  const response = await notion.dataSources.query({
    data_source_id: dataSourceId,
    sorts: [{ timestamp: "created_time", direction: "descending" }],
    page_size: 20,
  })

  for (const page of response.results) {
    if (isFullPage(page)) {
      // 휴지통이나 아카이브된 페이지는 건너뜀
      if ((page as any).in_trash || page.archived) continue

      const title = getPageTitle(page)
      if (title.includes(searchTitle) || title.includes(dateStr)) {
        return page
      }
    }
  }

  return null
}

// ─── 2) 블록 읽기 → 생성 payload 변환 ──────────────────────────

/**
 * BlockObjectResponse (읽기) → blocks.children.append 요청용 payload 변환.
 * Notion API는 블록 복제 전용 엔드포인트가 없으므로 수동 변환 필요.
 */
function blockToCreatePayload(
  block: BlockObjectResponse,
  dateStr: string
): Record<string, any> | null {
  const type = block.type
  const value = (block as any)[type]

  if (!value) return null

  // rich_text 복제 (날짜 치환 없이 원본 유지, template_mention만 텍스트로 변환)
  function replaceDateInRichText(richText: any[]): any[] {
    if (!Array.isArray(richText)) return richText
    return richText.map((rt) => {
      // template_mention (@Today 등)은 API로 생성 불가 → plain_text로 변환
      if (rt.type === "mention" && rt.mention?.type === "template_mention") {
        return {
          type: "text",
          text: { content: rt.plain_text || "", link: null },
          annotations: rt.annotations || {},
        }
      }
      // 일반 mention 블록은 그대로 복제
      if (rt.type === "mention") {
        return {
          type: "mention",
          mention: rt.mention,
          annotations: rt.annotations,
        }
      }
      return rt
    })
  }

  // rich_text 기반 블록 (paragraph, heading, list, quote, callout, toggle, code 등)
  const richTextBlockTypes = [
    "paragraph",
    "heading_1",
    "heading_2",
    "heading_3",
    "bulleted_list_item",
    "numbered_list_item",
    "to_do",
    "toggle",
    "quote",
    "callout",
    "code",
  ]

  if (richTextBlockTypes.includes(type)) {
    const payload: Record<string, any> = {
      type,
      [type]: {
        rich_text: replaceDateInRichText(value.rich_text || []),
      },
    }

    // 특수 속성 복제
    if (type === "to_do" && "checked" in value) {
      payload[type].checked = value.checked
    }
    if (type === "code" && value.language) {
      payload[type].language = value.language
    }
    if (type === "callout") {
      if (value.icon) payload[type].icon = value.icon
      if (value.color) payload[type].color = value.color
    }
    if (value.color && value.color !== "default") {
      payload[type].color = value.color
    }

    return payload
  }

  // divider
  if (type === "divider") {
    return { type: "divider", divider: {} }
  }

  // bookmark
  if (type === "bookmark") {
    return {
      type: "bookmark",
      bookmark: {
        url: value.url || "",
        caption: value.caption || [],
      },
    }
  }

  // image (external only — internal images can't be duplicated easily)
  if (type === "image") {
    if (value.type === "external") {
      return {
        type: "image",
        image: {
          type: "external",
          external: { url: value.external.url },
        },
      }
    }
    // internal image → skip (can't duplicate)
    return null
  }

  // embed
  if (type === "embed") {
    return {
      type: "embed",
      embed: { url: value.url || "" },
    }
  }

  // table_of_contents, breadcrumb
  if (type === "table_of_contents") {
    return { type: "table_of_contents", table_of_contents: {} }
  }
  if (type === "breadcrumb") {
    return { type: "breadcrumb", breadcrumb: {} }
  }

  // 지원하지 않는 블록 타입은 건너뜀
  console.log(`  ⚠️  블록 타입 '${type}' 은(는) 복제를 건너뜁니다.`)
  return null
}

// ─── 3) 템플릿 블록 트리 → 플랫 payload 배열 변환 ──────────────

interface BlockNode {
  payload: Record<string, any>
  children: BlockNode[]
}

/**
 * 플랫한 BlockWithDepth[] 를 트리 구조로 변환
 */
function buildBlockTree(items: BlockWithDepth[], dateStr: string): BlockNode[] {
  const roots: BlockNode[] = []
  const stack: { node: BlockNode; depth: number }[] = []

  for (const { block, depth } of items) {
    const payload = blockToCreatePayload(block, dateStr)
    if (!payload) continue

    const node: BlockNode = { payload, children: [] }

    // depth에 맞는 부모 찾기
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop()
    }

    if (stack.length === 0) {
      roots.push(node)
    } else {
      stack[stack.length - 1].node.children.push(node)
    }

    stack.push({ node, depth })
  }

  return roots
}

/**
 * 트리에 children 을 중첩하여 최종 API payload 배열 생성
 */
function treeToPayloads(nodes: BlockNode[]): Record<string, any>[] {
  return nodes.map((node) => {
    const payload = { ...node.payload }
    if (node.children.length > 0) {
      const type = payload.type
      if (payload[type]) {
        payload[type] = {
          ...payload[type],
          children: treeToPayloads(node.children),
        }
      }
    }
    return payload
  })
}

// ─── 4) 페이지 생성 ────────────────────────────────────────────

/**
 * 템플릿 블록을 복제하여 새 페이지를 생성합니다.
 */
export async function createDailyPage(
  databaseId: string,
  title: string,
  templateBlocks: BlockWithDepth[]
): Promise<PageObjectResponse> {
  console.log(`\n📝 새 페이지 생성: "${title}"`)

  // 블록 트리 생성
  const dateStr = title.match(/\d{4}-\d{2}-\d{2}/)?.[0] || todayString()
  const tree = buildBlockTree(templateBlocks, dateStr)
  const childrenPayloads = treeToPayloads(tree)

  console.log(`  → 복제할 블록: ${childrenPayloads.length}개 (최상위)`)

  // 페이지 생성 (블록 없이 먼저 생성)
  const newPage = await notion.pages.create({
    parent: { database_id: databaseId },
    properties: {
      title: {
        title: [{ type: "text", text: { content: title } }],
      },
      기준일: {
        date: { start: dateStr },
      },
    },
  })

  if (!isFullPage(newPage)) {
    throw new Error("페이지 생성에 실패했습니다.")
  }

  console.log(`  → 페이지 생성 완료: ${newPage.url}`)

  // 블록을 100개씩 배치로 추가 (API 제한)
  const BATCH_SIZE = 100
  for (let i = 0; i < childrenPayloads.length; i += BATCH_SIZE) {
    const batch = childrenPayloads.slice(i, i + BATCH_SIZE)
    await notion.blocks.children.append({
      block_id: newPage.id,
      children: batch as any,
    })
    if (i + BATCH_SIZE < childrenPayloads.length) {
      console.log(
        `  → 블록 추가 중... (${i + BATCH_SIZE}/${childrenPayloads.length})`
      )
      await sleep(350) // rate limit 대응
    }
  }

  console.log(`  ✅ 블록 ${childrenPayloads.length}개 추가 완료`)

  return newPage as PageObjectResponse
}

// ─── 5) 통합: 오늘 페이지 확보 ─────────────────────────────────

/**
 * 오늘 날짜의 "장마감 정리" 페이지를 확보합니다.
 * - 있으면 기존 페이지 반환
 * - 없으면 템플릿 복제하여 새로 생성
 */
export async function ensureTodayPage(
  dataSourceId: string,
  databaseId: string,
  dateStr: string,
  templatePageId?: string
): Promise<{ page: PageObjectResponse; created: boolean }> {
  // 1) 기존 페이지 확인
  console.log(`\n🔍 "${dateStr} 장마감 정리" 페이지 검색 중...`)
  const existing = await findTodayPage(dataSourceId, dateStr)

  if (existing) {
    console.log(`  ✅ 기존 페이지 발견: ${getPageTitle(existing)}`)
    console.log(`     URL: ${existing.url}`)
    return { page: existing, created: false }
  }

  console.log(`  ℹ️  오늘 페이지가 없습니다. 새로 생성합니다.`)

  // 2) 템플릿 블록 조회
  let templateBlocks: BlockWithDepth[]

  if (templatePageId) {
    console.log(`  📋 템플릿 페이지에서 블록 조회 중... (${templatePageId})`)
    templateBlocks = await fetchAllBlocks(templatePageId)
    console.log(`  → 템플릿 블록: ${templateBlocks.length}개`)
  } else {
    console.log(`  ⚠️  NOTION_TEMPLATE_PAGE_ID 가 설정되지 않았습니다.`)
    console.log(`     기본 골격으로 페이지를 생성합니다.`)
    templateBlocks = buildDefaultTemplateBlocks(dateStr)
  }

  // 3) 페이지 생성
  const title = `${dateStr} 장마감 정리`
  const page = await createDailyPage(databaseId, title, templateBlocks)

  return { page, created: true }
}

// ─── 기본 템플릿 (TEMPLATE_PAGE_ID 미설정 시 사용) ─────────────

function buildDefaultTemplateBlocks(dateStr: string): BlockWithDepth[] {
  // 기본 골격 블록을 BlockWithDepth 형식으로 구성
  const blocks: { type: string; text: string; depth: number }[] = [
    { type: "heading_3", text: `${dateStr} 장마감 정리`, depth: 0 },
    { type: "heading_3", text: "보유종목 체크", depth: 0 },
    { type: "paragraph", text: "스윙", depth: 0 },
    { type: "divider", text: "", depth: 0 },
    { type: "paragraph", text: "단타", depth: 0 },
    { type: "bulleted_list_item", text: "자동 매매 종목", depth: 0 },
    { type: "bulleted_list_item", text: "프로그램 개선 사항", depth: 0 },
    { type: "bulleted_list_item", text: "체크해야 할 종목", depth: 0 },
    { type: "heading_3", text: "단테 라이브", depth: 0 },
    { type: "paragraph", text: "시초가(단테)", depth: 0 },
    { type: "paragraph", text: "VIP(단테, 목요일만)", depth: 0 },
    { type: "paragraph", text: "종가(또사)", depth: 0 },
    { type: "heading_3", text: "오늘의 인사이트", depth: 0 },
    { type: "divider", text: "", depth: 0 },
    { type: "heading_3", text: `${dateStr} 국내외 시장 지수`, depth: 0 },
    { type: "bulleted_list_item", text: "NASDAQ : ", depth: 0 },
    { type: "bulleted_list_item", text: "S&P500 : ", depth: 0 },
    { type: "bulleted_list_item", text: "KOSPI : ", depth: 0 },
    { type: "bulleted_list_item", text: "KOSDAQ : ", depth: 0 },
    { type: "divider", text: "", depth: 0 },
    { type: "heading_3", text: `${dateStr} 주요 테마`, depth: 0 },
    { type: "divider", text: "", depth: 0 },
    { type: "heading_3", text: `${dateStr} 의 상한가`, depth: 0 },
    { type: "paragraph", text: "코스피", depth: 0 },
    { type: "paragraph", text: "코스닥", depth: 0 },
    { type: "divider", text: "", depth: 0 },
    { type: "heading_3", text: `${dateStr} 의 관심종목`, depth: 0 },
    { type: "heading_3", text: "세력봉(500억 ↑)", depth: 0 },
    { type: "heading_3", text: "스윙 발굴 종목", depth: 0 },
    { type: "heading_3", text: "단테 추천 종목", depth: 0 },
    { type: "divider", text: "", depth: 0 },
  ]

  // BlockObjectResponse 대역 생성 (blockToCreatePayload가 처리할 수 있게)
  return blocks.map((b) => ({
    block: createFakeBlock(b.type, b.text),
    depth: b.depth,
  }))
}

/** blockToCreatePayload가 처리할 수 있는 최소한의 블록 객체 생성 */
function createFakeBlock(type: string, text: string): BlockObjectResponse {
  const base = {
    id: "fake",
    type,
    has_children: false,
    archived: false,
    in_trash: false,
    created_time: "",
    last_edited_time: "",
    created_by: { id: "fake", object: "user" as const },
    last_edited_by: { id: "fake", object: "user" as const },
    parent: { type: "page_id" as const, page_id: "fake" },
    object: "block" as const,
  }

  if (type === "divider") {
    return { ...base, type: "divider", divider: {} } as any
  }

  return {
    ...base,
    [type]: {
      rich_text: text
        ? [
            {
              type: "text",
              text: { content: text, link: null },
              annotations: {
                bold: false,
                italic: false,
                strikethrough: false,
                underline: false,
                code: false,
                color: "default",
              },
              plain_text: text,
              href: null,
            },
          ]
        : [],
    },
  } as any
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
