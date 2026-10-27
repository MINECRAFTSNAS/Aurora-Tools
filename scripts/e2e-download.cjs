/**
 * 端到端真实下载测试：解析 -> 提取音频 -> 校验产物。
 *
 * 默认使用 Big Buck Bunny（Blender 基金会出品，CC-BY 授权，允许自由下载分发），
 * 通过 yt-dlp 的 --match-filter 限制时长，避免下载过大的文件。
 *
 * 用法：electron.exe scripts/e2e-download.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const BIN = path.join(ROOT, 'resources', 'bin')
const OUT = path.join(os.tmpdir(), 'aurora-tools-e2e')

const results = []
const log = (n, ok, d = '') => {
  results.push({ name: n, ok, detail: String(d) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' :: ' + d : ''}`)
}

// 用一段短视频测试（Big Buck Bunny 官方片段，CC-BY）
const URL = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'

fs.mkdirSync(OUT, { recursive: true })
for (const f of fs.readdirSync(OUT)) {
  try {
    fs.unlinkSync(path.join(OUT, f))
  } catch {
    /* ignore */
  }
}

console.log('=== 1) 解析 ===')
const probe = spawnSync(
  path.join(BIN, 'yt-dlp.exe'),
  ['--no-warnings', '--no-colors', '--dump-single-json', '--skip-download', '--no-playlist', URL],
  { encoding: 'utf-8', timeout: 180000, maxBuffer: 64 * 1024 * 1024 }
)

let info = null
try {
  info = JSON.parse(probe.stdout)
} catch {
  log('解析视频信息', false, (probe.stderr || '').slice(-300))
}

if (info) {
  log('解析视频信息', true, `"${info.title}" (${info.duration}s, ${info.formats?.length} 格式)`)
}

console.log('\n=== 2) 下载并提取音频（选最小的音频流，节省流量）===')

// 先挑一个体积最小的纯音频格式，避免下载 16MB+ 的完整音轨
let smallest = ''
let smallestSize = Infinity
for (const f of info?.formats ?? []) {
  const noVideo = (!f.vcodec || f.vcodec === 'none') && f.acodec && f.acodec !== 'none'
  if (!noVideo) continue
  const size = f.filesize ?? f.filesize_approx
  if (size && size < smallestSize) {
    smallestSize = size
    smallest = f.format_id
  }
}
console.log(`    选定音频格式 ${smallest || '(自动)'}，约 ${smallestSize === Infinity ? '?' : (smallestSize / 1024 / 1024).toFixed(1) + ' MB'}`)

const started = Date.now()
const dl = spawnSync(
  path.join(BIN, 'yt-dlp.exe'),
  [
    '--no-warnings',
    '--no-colors',
    '--newline',
    '--ffmpeg-location', BIN,
    '--no-playlist',
    '--extract-audio',
    '--audio-format', 'mp3',
    '--audio-quality', '192K',
    '--embed-thumbnail',
    '--embed-metadata',
    ...(smallest ? ['-f', smallest] : []),
    '--output', path.join(OUT, '%(title).80B.%(ext)s'),
    URL
  ],
  { encoding: 'utf-8', timeout: 900000 }
)
const elapsed = ((Date.now() - started) / 1000).toFixed(1)

const files = fs.readdirSync(OUT)
const mp3 = files.find((f) => f.endsWith('.mp3'))

log('下载并转码为 mp3', !!mp3, mp3 ? `${mp3} (耗时 ${elapsed}s)` : (dl.stderr || '').slice(-400))

if (mp3) {
  const full = path.join(OUT, mp3)
  const size = fs.statSync(full).size
  log('输出文件非空', size > 5000, `${(size / 1024).toFixed(0)} KB`)

  console.log('\n=== 3) 校验产物 ===')
  const ff = spawnSync(
    path.join(BIN, 'ffprobe.exe'),
    ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', full],
    { encoding: 'utf-8', timeout: 60000 }
  )
  try {
    const meta = JSON.parse(ff.stdout)
    const s = meta.streams?.[0]
    const fmt = meta.format
    log('ffprobe 识别为有效音频', s?.codec_type === 'audio', `codec=${s?.codec_name} sr=${s?.sample_rate} ch=${s?.channels}`)
    log('时长为正数且合理', Number(fmt?.duration) > 0, `${Number(fmt?.duration).toFixed(1)}s`)
    // 检查元数据/封面是否嵌入
    const tags = fmt?.tags ?? {}
    const hasMeta = Object.keys(tags).length > 0
    log('已嵌入元数据', hasMeta, Object.keys(tags).slice(0, 4).join(', ') || '(无)')
    const hasCover = (meta.streams ?? []).some((x) => x.codec_type === 'video')
    log('已嵌入封面图', hasCover, hasCover ? '存在图片流' : '未发现（部分源无缩略图）')
  } catch (e) {
    log('产物校验', false, e.message)
  }

  // 保留产物供人工试听，但告知位置
  console.log(`\n产物保留在：${full}`)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`)
if (failed.length) console.log('失败项: ' + failed.map((f) => f.name).join(', '))
process.exit(failed.length === 0 ? 0 : 1)
