/**
 * S-06 回归测试：视频下载完成后，任务记录的产物路径必须真实存在。
 *
 * 背景：B 站等站点的视频常需要「合并 → 转封装」，而 yt-dlp 会把中间文件删掉。
 * 如果只解析 [Merger] 而漏掉 [VideoRemuxer]，任务里存的就是已被删除的 .mkv，
 * 表现为「下载完成但提示文件不存在」。
 *
 * 做法：本地造一个 h264+aac 的 mkv，用 HTTP 提供，让应用按真实参数下载
 * （容器设置 mp4 → 触发 mkv→mp4 转封装），最后断言产物存在且是 mp4。
 *
 * 用法：electron.exe scripts/verify-video-artifact.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const http = require('node:http')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const FFMPEG = path.join(ROOT, 'resources', 'bin', 'ffmpeg.exe')
const WEB_PORT = 9712

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail: String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`)
}

const { app, BrowserWindow } = require('electron')

// 独立 userData：不读写用户真实设置
const UD = path.join(os.tmpdir(), 'aurora-tools-ud-artifact')
fs.rmSync(UD, { recursive: true, force: true })
fs.mkdirSync(UD, { recursive: true })
app.setPath('userData', UD)

const WORK = path.join(os.tmpdir(), 'aurora-tools-artifact')
fs.rmSync(WORK, { recursive: true, force: true })
const SRC_DIR = path.join(WORK, 'src')
const OUT_DIR = path.join(WORK, 'out')
fs.mkdirSync(SRC_DIR, { recursive: true })
fs.mkdirSync(OUT_DIR, { recursive: true })

const SRC = path.join(SRC_DIR, 'clip.mkv')
spawnSync(
  FFMPEG,
  [
    '-y',
    '-f', 'lavfi', '-i', 'color=c=navy:s=320x240:d=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest', SRC
  ],
  { encoding: 'utf-8', timeout: 120000 }
)

const server = http.createServer((req, res) => {
  try {
    const st = fs.statSync(SRC)
    res.writeHead(200, { 'Content-Type': 'video/x-matroska', 'Content-Length': st.size })
    fs.createReadStream(SRC).pipe(res)
  } catch {
    res.writeHead(404).end()
  }
})

require(path.join(ROOT, 'dist-electron', 'main', 'index.js'))

app.whenReady().then(async () => {
  const started = spawnSync(FFMPEG, ['-version'], { encoding: 'utf-8' })
  check('生成测试素材（h264+aac 的 mkv）', fs.existsSync(SRC), `${(fs.statSync(SRC).size / 1024).toFixed(0)} KB ffmpeg=${started.status}`)

  await new Promise((resolve) => server.listen(WEB_PORT, '127.0.0.1', resolve))

  let win = null
  for (let i = 0; i < 30; i++) {
    win = BrowserWindow.getAllWindows()[0]
    if (win) break
    await new Promise((r) => setTimeout(r, 400))
  }
  if (!win) {
    check('应用启动', false, 'no window')
    return finish()
  }

  const js = (code) => win.webContents.executeJavaScript(code, true)

  for (let i = 0; i < 40; i++) {
    if (await js(`!!document.querySelector('.probe')`).catch(() => false)) break
    await new Promise((r) => setTimeout(r, 400))
  }

  // 下载目录指向临时目录，容器固定 mp4（会触发 mkv→mp4 转封装）
  await js(`window.tools.setSettings(${JSON.stringify({ downloadDir: OUT_DIR, videoContainer: 'mp4' })})`)

  const url = `http://127.0.0.1:${WEB_PORT}/clip.mkv`
  const jobId = await js(
    `window.tools.createJob(${JSON.stringify({
      url,
      kind: 'video',
      formatId: '',
      title: 'clip',
      target: '最佳画质 · MP4'
    })})`
  )
  check('创建视频任务', typeof jobId === 'string' && jobId.length > 0)

  let job = null
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    const list = JSON.parse(await js(`window.tools.listJobs().then(r=>JSON.stringify(r))`))
    job = list.find((j) => j.id === jobId)
    if (job && (job.status === 'done' || job.status === 'error')) break
  }

  check('视频任务完成', job?.status === 'done', `status=${job?.status}${job?.error ? ' err=' + job.error : ''}`)
  if (job?.status !== 'done') {
    console.log('--- 任务日志尾部 ---')
    console.log((job?.log ?? []).slice(-12).join('\n'))
  }

  const recorded = job?.outputPath ?? ''
  check('任务记录了产物路径', recorded.length > 0, recorded)
  check('记录的产物真实存在（关键）', !!recorded && fs.existsSync(recorded), recorded || '(空)')

  if (recorded && fs.existsSync(recorded)) {
    const size = fs.statSync(recorded).size
    check('产物是 mp4 且非空', /\.mp4$/i.test(recorded) && size > 0, `${path.basename(recorded)} ${(size / 1024).toFixed(0)} KB`)
  }

  // 中间文件应当已被清理，目录里只剩 mp4
  const left = fs.readdirSync(OUT_DIR).filter((f) => !/\.(part|ytdl|temp)$/i.test(f))
  check('未残留中间文件', left.every((f) => /\.mp4$/i.test(f)), left.join(', ') || '(空)')

  // 转封装应当被识别为"转换中"阶段（日志里应有该行）
  const sawRemux = (job?.log ?? []).some((l) => l.includes('[VideoRemuxer] Remuxing'))
  check('确认走的是转封装分支', sawRemux, sawRemux ? '日志含 [VideoRemuxer] Remuxing' : '未出现（可能直接合并为 mp4）')

  win.webContents.debugger.detach?.()
  server.close()
  finish()
})

function finish() {
  const failed = results.filter((r) => !r.ok)
  console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`)
  if (failed.length) console.log('失败项: ' + failed.map((f) => f.name).join(', '))
  fs.writeFileSync(path.join(ROOT, 'verify-video-artifact.json'), JSON.stringify(results, null, 2))
  app.exit(failed.length === 0 ? 0 : 1)
}
