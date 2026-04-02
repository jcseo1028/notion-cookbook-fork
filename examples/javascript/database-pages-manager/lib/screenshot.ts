/**
 * 핀업 테마록 페이지 스크린샷 캡처 + 이미지 압축
 *
 * Puppeteer로 headless Chrome 캡처 → sharp로 5MB 이하 JPEG 압축
 */

import puppeteer from "puppeteer"
import sharp from "sharp"
import { statSync, mkdirSync, existsSync } from "fs"
import { readFile } from "fs/promises"
import { join, dirname, basename } from "path"
import { notion } from "./notion-client.js"

const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB

/**
 * 핀업 테마록 차트+테이블 영역을 스크린샷으로 캡처합니다.
 * - #desc1: 트리맵 차트 + 테마 순위 테이블 + 우측 채팅 영역 (전체 콘텐츠)
 * - #treemap: 트리맵 차트만
 * @param outputPath 저장할 파일 경로 (.jpg)
 * @returns 저장된 파일 경로
 */
export async function captureThemeTable(outputPath: string): Promise<string> {
  console.log("  📸 핀업 테마록 스크린샷 캡처 중...")

  // 출력 디렉토리 확보
  const dir = dirname(outputPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const rawPath = outputPath.replace(/\.[^.]+$/, "_raw.png")

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  })

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1400, height: 900 })

    await page.goto("https://finance.finup.co.kr/Lab/ThemeLog", {
      waitUntil: "networkidle2",
      timeout: 30000,
    })

    // 트리맵 렌더링 대기
    await page.waitForSelector("#treemap", { timeout: 10000 }).catch(() => {
      console.log("    ⚠️ #treemap 셀렉터를 찾지 못했습니다.")
    })
    await new Promise((r) => setTimeout(r, 3000))

    // .contents01: 탭 헤더(날짜/시간) + 트리맵 차트 + 테마 테이블 전체
    const chartEl = await page.$(".contents01")
    if (chartEl) {
      await chartEl.screenshot({ path: rawPath })
      console.log("    ✅ 테마록 콘텐츠 영역 캡처 완료")
    } else {
      // fallback: 전체 페이지
      await page.screenshot({ path: rawPath, fullPage: true })
      console.log("    ⚠️ .contents01을 찾지 못해 전체 페이지 캡처")
    }
  } finally {
    await browser.close()
  }

  // 5MB 이하로 압축
  await compressImage(rawPath, outputPath)
  return outputPath
}

/**
 * 이미지를 5MB 이하 JPEG로 압축합니다.
 */
async function compressImage(
  inputPath: string,
  outputPath: string
): Promise<void> {
  let quality = 85
  let width: number | undefined = undefined

  while (quality >= 40) {
    const pipeline = sharp(inputPath)
    if (width) pipeline.resize({ width })
    await pipeline.jpeg({ quality }).toFile(outputPath)

    const size = statSync(outputPath).size
    if (size <= MAX_IMAGE_SIZE) {
      const sizeMB = (size / 1024 / 1024).toFixed(2)
      console.log(`    ✅ 이미지 압축 완료: ${sizeMB}MB (quality=${quality})`)
      return
    }

    // 초과 시: 품질 10 하향 + 폭 90%로 축소
    quality -= 10
    const meta = await sharp(inputPath).metadata()
    width = Math.round((width || meta.width || 1400) * 0.9)
  }

  const finalSize = statSync(outputPath).size
  const sizeMB = (finalSize / 1024 / 1024).toFixed(2)
  console.warn(`    ⚠️ 최소 품질에도 ${sizeMB}MB — 현재 크기로 사용`)
}

/**
 * 로컬 이미지 파일을 Notion에 업로드합니다.
 * @param filePath 업로드할 이미지 파일 경로 (.jpg)
 * @returns Notion file upload ID
 */
export async function uploadImageToNotion(filePath: string): Promise<string> {
  console.log("  📤 Notion에 테마록 스크린샷 업로드 중...")
  const fileUpload = await notion.fileUploads.create({ mode: "single_part" })
  await notion.fileUploads.send({
    file_upload_id: fileUpload.id,
    file: {
      filename: basename(filePath),
      data: new Blob([await readFile(filePath)], { type: "image/jpeg" }),
    },
  })
  console.log(`    ✅ 업로드 완료 (ID: ${fileUpload.id})`)
  return fileUpload.id
}
