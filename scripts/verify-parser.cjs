/**
 * 解析器单元测试：用 yt-dlp 的真实输出行验证产物路径解析。
 *
 * 这些行不是编的——都是在本地用 --load-info-json 跑真实的合并/转封装流程抓下来的。
 *
 * 用法：node scripts/verify-parser.cjs
 */
const path = require('node:path')
const fs = require('node:fs')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, '.tmp-ytdlp.cjs')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail: String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`)
}

// 用 esbuild 把 TS 单独打成一个可 require 的 CJS
function build() {
  const esbuild = require('esbuild')
  esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'src', 'main', 'ytdlp.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: OUT,
    logLevel: 'silent'
  })
}

try {
  build()
  const { parseDestination, isPostProcessLine } = require(OUT)

  const cases = [
    // [说明, 输入行, 期望]
    ['下载中间文件', '[download] Destination: C:\\out\\a.fv.mp4', 'C:\\out\\a.fv.mp4'],
    ['带进度的下载行不是产物', '[download]  42.2% of    2.37KiB at  500KiB/s ETA 00:00', null],
    ['合并产物（带引号）', '[Merger] Merging formats into "C:\\out\\a.mkv"', 'C:\\out\\a.mkv'],
    [
      '转封装产物（关键：以前漏掉这一行）',
      '[VideoRemuxer] Remuxing video from mkv to mp4; Destination: C:\\out\\a.mp4',
      'C:\\out\\a.mp4'
    ],
    [
      '无需转封装时不应改写产物',
      '[VideoRemuxer] Not remuxing media file "C:\\out\\a.mp4"; already is in target format mp4',
      null
    ],
    ['提取音频产物', '[ExtractAudio] Destination: C:\\out\\a.mp3', 'C:\\out\\a.mp3'],
    ['视频转码产物', '[VideoConvertor] Converting video from mkv to mp4; Destination: C:\\out\\b.mp4', 'C:\\out\\b.mp4'],
    ['已存在文件', '[download] C:\\out\\a.mp4 has already been downloaded', 'C:\\out\\a.mp4'],
    ['删除中间文件不应影响产物', 'Deleting original file C:\\out\\a.mkv (pass -k to keep)', null],
    ['无关日志', '[info] a: Downloading 1 format(s): v+a', null]
  ]

  for (const [name, line, expected] of cases) {
    const got = parseDestination(line)
    check(name, got === expected, `期望 ${JSON.stringify(expected)} 实得 ${JSON.stringify(got)}`)
  }

  check(
    '转封装阶段会被标记为后处理',
    isPostProcessLine('[VideoRemuxer] Remuxing video from mkv to mp4; Destination: C:\\out\\a.mp4') === true
  )
  check('转码阶段会被标记为后处理', isPostProcessLine('[VideoConvertor] Converting video ...') === true)
  check('普通下载行不误判为后处理', isPostProcessLine('[download] 100% of 2.37KiB in 00:00') === false)

  // 顺序语义：最终产物必须是"最后出现的那个 Destination"
  const seq = [
    '[download] Destination: C:\\out\\a.fv.mp4',
    '[download] Destination: C:\\out\\a.fa.m4a',
    '[Merger] Merging formats into "C:\\out\\a.mkv"',
    '[VideoRemuxer] Remuxing video from mkv to mp4; Destination: C:\\out\\a.mp4'
  ]
  let last = null
  for (const line of seq) {
    const p = parseDestination(line)
    if (p) last = p
  }
  check('按输出顺序取最后一次 Destination', last === 'C:\\out\\a.mp4', String(last))
} catch (e) {
  check('解析器测试执行', false, e.message)
} finally {
  try {
    fs.unlinkSync(OUT)
  } catch {
    /* ignore */
  }
}

const failed = results.filter((r) => !r.ok)
console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`)
if (failed.length) console.log('失败项: ' + failed.map((f) => f.name).join(', '))
process.exit(failed.length === 0 ? 0 : 1)
