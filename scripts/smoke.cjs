/**
 * 自动化冒烟测试：加载被测主进程，断言 UI 结构与 IPC 通道，
 * 并用真实媒体做端到端验证（本地视频抽音轨 + 网络解析）。
 *
 * 用法：electron.exe scripts/smoke.cjs [--online]
 *   --online  额外跑网络解析测试（依赖外网，可能因站点风控而不稳定）
 */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const ROOT = path.resolve(__dirname, '..')
const ONLINE = process.argv.includes('--online')

const results = []
const log = (name, ok, detail = '') => {
  results.push({ name, ok, detail: String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`)
}
const skip = (name, why) => {
  results.push({ name, ok: true, detail: `SKIP: ${why}` })
  console.log(`SKIP  ${name} :: ${why}`)
}

const { app, BrowserWindow } = require('electron')
app.setAppUserModelId('com.aurora.tools.smoke')

// 载入被测主进程（真实 IPC + 真实工具解析）
require(path.join(ROOT, 'dist-electron', 'main', 'index.js'))

app.whenReady().then(async () => {
  await new Promise((r) => setTimeout(r, 2500))
  const wins = BrowserWindow.getAllWindows()
  log('主进程创建窗口', wins.length >= 1, `${wins.length} 个窗口`)
  const win = wins[0]
  if (!win) {
    finish()
    return
  }

  const js = (code) => win.webContents.executeJavaScript(code, true)

  for (let i = 0; i < 30; i++) {
    if (await js(`!!document.querySelector('.probe')`).catch(() => false)) break
    await new Promise((r) => setTimeout(r, 400))
  }

  /* ---------- 1. 渲染层结构 ---------- */
  try {
    const ui = await js(`JSON.stringify({
      api: typeof window.tools === 'object',
      apiKeys: window.tools ? Object.keys(window.tools).length : 0,
      probe: !!document.querySelector('.probe'),
      queue: !!document.querySelector('.queue'),
      urlInput: !!document.querySelector('.probe__input'),
      caption: document.querySelectorAll('.caption-btn').length,
      settingsBtn: !!document.querySelector('.titlebar__actions .icon-btn'),
      statusDot: !!document.querySelector('.statusdot'),
      segmentItems: document.querySelectorAll('.segment__item').length,
      text: document.body.innerText.replace(/\\n+/g,' | ').slice(0,110)
    })`)
    const u = JSON.parse(ui)
    log('preload API 注入', u.api, `${u.apiKeys} 个方法`)
    log('解析面板', u.probe && u.urlInput)
    log('队列面板', u.queue)
    log('窗口按钮（3 个）', u.caption === 3, `${u.caption} 个`)
    log('设置按钮 + 状态指示', u.settingsBtn && u.statusDot)
    log('界面文案', u.text.length > 0, u.text)
  } catch (e) {
    log('渲染层断言', false, e.message)
  }

  /* ---------- 2. 内置工具自检 ---------- */
  let toolInfo = null
  try {
    toolInfo = JSON.parse(await js(`window.tools.checkTools().then(r=>JSON.stringify(r))`))
    log('内置 yt-dlp 可用', toolInfo.ytdlp === true, `version=${toolInfo.ytdlpVersion}`)
    log('内置 ffmpeg 可用', toolInfo.ffmpeg === true, `version=${toolInfo.ffmpegVersion}`)
    log('二进制目录定位', !!toolInfo.binDir, toolInfo.binDir)
  } catch (e) {
    log('工具自检', false, e.message)
  }

  /* ---------- 3. 生成测试视频，验证本地抽音轨链路 ---------- */
  try {
    const tmp = path.join(os.tmpdir(), 'aurora-tools-test.mp4')
    const outDir = path.join(os.tmpdir(), 'aurora-tools-out')
    fs.mkdirSync(outDir, { recursive: true })
    // 先清掉可能残留的输出
    for (const f of fs.existsSync(outDir) ? fs.readdirSync(outDir) : []) {
      try {
        fs.unlinkSync(path.join(outDir, f))
      } catch {
        /* ignore */
      }
    }

    if (!fs.existsSync(tmp)) {
      const binDir = toolInfo?.binDir
      if (!binDir) throw new Error('binDir 未知')
      // 用内置 ffmpeg 合成一段带音轨的测试视频（正弦波 440Hz + 纯色画面）
      const { spawnSync } = require('node:child_process')
      const r = spawnSync(
        path.join(binDir, 'ffmpeg.exe'),
        [
          '-y', '-f', 'lavfi', '-i', 'color=c=navy:s=320x240:d=3',
          '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
          '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-shortest', tmp
        ],
        { encoding: 'utf-8', timeout: 120000 }
      )
      if (!fs.existsSync(tmp)) {
        throw new Error('生成测试视频失败：' + (r.stderr || '').slice(-300))
      }
    }
    log('生成测试视频', fs.existsSync(tmp), `${(fs.statSync(tmp).size / 1024).toFixed(0)} KB`)

    // 走真实 IPC：本地视频 -> mp3
    const raw = await js(
      `window.tools.extractLocalAudio(${JSON.stringify({
        files: [tmp],
        format: 'mp3',
        bitrate: '192',
        outDir
      })}).then(r => JSON.stringify(r))`
    )
    const res = JSON.parse(raw)
    const first = res[0]
    log('本地视频抽音轨（真实 ffmpeg）', first?.ok === true, first?.error ?? first?.output)

    if (first?.ok && fs.existsSync(first.output)) {
      const size = fs.statSync(first.output).size
      log('输出音频文件已生成', size > 1000, `${(size / 1024).toFixed(0)} KB`)

      // 用 ffprobe 验证它确实是有效音频
      const { spawnSync } = require('node:child_process')
      const probe = spawnSync(
        path.join(toolInfo.binDir, 'ffprobe.exe'),
        ['-v', 'error', '-show_entries', 'stream=codec_name,channels,duration', '-of', 'json', first.output],
        { encoding: 'utf-8', timeout: 30000 }
      )
      const meta = JSON.parse(probe.stdout || '{}')
      const stream = meta.streams?.[0]
      log(
        '输出可被 ffprobe 识别为音频',
        stream?.codec_name === 'mp3',
        `codec=${stream?.codec_name} channels=${stream?.channels} dur=${stream?.duration}`
      )

      // 清理
      try {
        fs.unlinkSync(first.output)
      } catch {
        /* ignore */
      }
    }

    // 测试 flac 无损路径
    const raw2 = await js(
      `window.tools.extractLocalAudio(${JSON.stringify({
        files: [tmp],
        format: 'flac',
        bitrate: '192',
        outDir
      })}).then(r => JSON.stringify(r))`
    )
    const res2 = JSON.parse(raw2)
    log('本地抽音轨 FLAC（无损）', res2[0]?.ok === true, res2[0]?.error ?? res2[0]?.output)
    if (res2[0]?.ok) {
      try {
        fs.unlinkSync(res2[0].output)
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    log('本地抽音轨链路', false, e.message)
  }

  /* ---------- 4. 任务队列 IPC ---------- */
  try {
    const jobs = JSON.parse(await js(`window.tools.listJobs().then(r=>JSON.stringify(r))`))
    log('任务列表接口', Array.isArray(jobs), `${jobs.length} 个任务`)

    // 创建一个必然失败的下载任务，验证错误处理与队列回收
    const id = await js(
      `window.tools.createJob(${JSON.stringify({
        url: 'https://invalid.invalid.example/never',
        kind: 'audio',
        formatId: '',
        title: 'smoke-fail-test',
        target: 'MP3 192k'
      })})`
    )
    log('可创建下载任务', typeof id === 'string' && id.length > 0, `id=${String(id).slice(0, 8)}…`)

    // 等待它失败（应当被 humanizeError 包装）
    let failed = null
    for (let i = 0; i < 40; i++) {
      const list = JSON.parse(await js(`window.tools.listJobs().then(r=>JSON.stringify(r))`))
      const job = list.find((j) => j.id === id)
      if (job && (job.status === 'error' || job.status === 'done')) {
        failed = job
        break
      }
      await new Promise((r) => setTimeout(r, 800))
    }
    log(
      '无效地址正确失败并给出可读原因',
      failed?.status === 'error' && !!failed.error,
      `${failed?.status} — ${failed?.error}`
    )
    await js(`window.tools.removeJob(${JSON.stringify(id)})`)
  } catch (e) {
    log('任务队列 IPC', false, e.message)
  }

  /* ---------- 5. 真实网络解析 ---------- */
  if (ONLINE) {
    // 用官方测试视频（yt-dlp 项目自用，允许下载）
    const testUrls = [
      'https://www.youtube.com/watch?v=aqz-KE-bpKQ', // Big Buck Bunny（CC 授权）
      'https://www.youtube.com/watch?v=BaW_jenozKc'
    ]
    let ok = false
    for (const u of testUrls) {
      try {
        const raw = await js(`window.tools.probe(${JSON.stringify(u)}).then(r=>JSON.stringify(r))`)
        const info = JSON.parse(raw)
        log(
          '网络解析真实站点',
          !!info.title && info.formats.length > 0,
          `title="${String(info.title).slice(0, 40)}" formats=${info.formats.length} duration=${info.duration}s`
        )
        const audioFmt = info.formats.filter((f) => f.audioOnly).length
        const videoFmt = info.formats.filter((f) => !f.audioOnly).length
        log('格式分类正确', videoFmt > 0, `视频 ${videoFmt} 个 / 音频 ${audioFmt} 个`)
        ok = true
        break
      } catch (e) {
        console.log(`    (${u} 解析失败：${String(e.message).slice(0, 120)})`)
      }
    }
    if (!ok) {
      skip('网络解析真实站点', '所有测试链接均不可用（站点风控或网络限制属预期内）')
    }
  } else {
    skip('网络解析真实站点', '未启用 --online')
  }

  finish()
})

function finish() {
  const failed = results.filter((r) => !r.ok)
  console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`)
  if (failed.length) console.log('失败项: ' + failed.map((f) => f.name).join(', '))
  fs.writeFileSync(path.join(ROOT, 'smoke-report.json'), JSON.stringify(results, null, 2))
  app.exit(failed.length === 0 ? 0 : 1)
}
