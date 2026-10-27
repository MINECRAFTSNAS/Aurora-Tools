/**
 * 打包产物验证：启动 release/win-unpacked 里的真实 exe，
 * 通过 CDP 断言内置二进制在打包后仍能被正确定位并执行。
 *
 * 这是最关键的一环 —— resourcesPath 拼接、extraResources 落位、
 * 以及打包后 yt-dlp/ffmpeg 能否真正跑起来，只有在这里才能验证。
 *
 * 用法：node scripts/verify-packaged.cjs [portable|unpacked]
 */
const path = require('node:path')
const fs = require('node:fs')
const http = require('node:http')

const ROOT = path.resolve(__dirname, '..')
const MODE = process.argv[2] || 'unpacked'
const PORT = 9677

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail: String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`)
}

const EXE =
  MODE === 'portable'
    ? path.join(ROOT, 'release', 'Aurora Tools-1.0.0-portable.exe')
    : path.join(ROOT, 'release', 'win-unpacked', 'Aurora Tools.exe')

async function main() {
  check('目标可执行文件存在', fs.existsSync(EXE), path.basename(EXE))

  // 打包资源落位检查
  const resDir =
    MODE === 'portable'
      ? null
      : path.join(ROOT, 'release', 'win-unpacked', 'resources')
  if (resDir) {
    for (const f of ['yt-dlp.exe', 'ffmpeg.exe', 'ffprobe.exe']) {
      const p = path.join(resDir, 'bin', f)
      const ok = fs.existsSync(p)
      check(`resources/bin/${f} 已随包分发`, ok, ok ? `${(fs.statSync(p).size / 1048576).toFixed(2)} MB` : '缺失')
    }
    check('asar 应用包存在', fs.existsSync(path.join(resDir, 'app.asar')))
  }

  const { spawn } = require('node:child_process')
  const child = spawn(EXE, [`--remote-debugging-port=${PORT}`], {
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  let stderr = ''
  child.stderr.on('data', (d) => (stderr += d.toString()))

  // 等待 CDP 就绪
  let target = null
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    try {
      const list = await cdpGet(`/json/list`)
      const pages = JSON.parse(list).filter((p) => p.type === 'page')
      if (pages.length && !pages[0].url.startsWith('devtools')) {
        target = pages[0]
        break
      }
    } catch {
      /* 还没起来 */
    }
    if (child.exitCode !== null) break
  }

  if (!target) {
    check('打包应用启动', false, `进程退出码=${child.exitCode} stderr=${stderr.slice(-400)}`)
    finish()
    return
  }
  check('打包应用启动并暴露调试端口', true, target.title)

  let id = 0
  const pending = new Map()
  const ws = await connectWs(target.webSocketDebuggerUrl, (msg) => {
    const p = pending.get(msg.id)
    if (p) {
      pending.delete(msg.id)
      p(msg)
    }
  })

  const evaluate = (expression) =>
    new Promise((resolve, reject) => {
      const myId = ++id
      pending.set(myId, (msg) => {
        if (msg.result?.exceptionDetails) {
          reject(new Error(msg.result.exceptionDetails.text + ' ' + (msg.result.exceptionDetails.exception?.description || '')))
        } else {
          resolve(msg.result?.result?.value)
        }
      })
      ws.send(
        JSON.stringify({
          id: myId,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true }
        })
      )
      setTimeout(() => {
        if (pending.has(myId)) {
          pending.delete(myId)
          reject(new Error('evaluate timeout'))
        }
      }, 120000)
    })

  try {
    // 等待渲染层挂载完成：CDP 就绪 ≠ React 已渲染
    let mounted = false
    for (let i = 0; i < 40; i++) {
      mounted = await evaluate(`!!document.querySelector('.probe') && !!window.tools`).catch(() => false)
      if (mounted) break
      await new Promise((r) => setTimeout(r, 500))
    }
    check('渲染层已挂载', mounted)

    // UI 结构
    const ui = JSON.parse(
      await evaluate(`JSON.stringify({
        title: document.title,
        api: typeof window.tools === 'object',
        apiKeys: window.tools ? Object.keys(window.tools).length : 0,
        probe: !!document.querySelector('.probe'),
        queue: !!document.querySelector('.queue'),
        urlInput: !!document.querySelector('.probe__input'),
        caption: document.querySelectorAll('.caption-btn').length,
        statusDot: !!document.querySelector('.statusdot')
      })`)
    )
    check('窗口标题', ui.title === 'Aurora Tools', ui.title)
    check('preload API 注入', ui.api, `${ui.apiKeys} 个方法`)
    check('解析面板与队列面板', ui.probe && ui.queue && ui.urlInput)
    check('窗口控制按钮', ui.caption === 3, `${ui.caption} 个`)
    check('工具状态指示器', ui.statusDot)

    // 核心：打包后内置工具是否可用
    const tools = JSON.parse(await evaluate(`window.tools.checkTools().then(r=>JSON.stringify(r))`))
    check('打包后 yt-dlp 可执行', tools.ytdlp === true, `v${tools.ytdlpVersion}`)
    check('打包后 ffmpeg 可执行', tools.ffmpeg === true, `v${tools.ffmpegVersion}`)

    const appInfo = JSON.parse(await evaluate(`window.tools.appInfo().then(r=>JSON.stringify(r))`))
    check('binDir 指向 resources/bin', /resources[\\/]bin$/.test(appInfo.binDir), appInfo.binDir)
    check('binDir 实际存在', fs.existsSync(appInfo.binDir))
    check('无外部依赖（未回退到仓库路径）', !appInfo.binDir.includes(`${path.sep}aurora-tools${path.sep}resources`), appInfo.binDir)
    check('版本号正确', appInfo.version === '1.0.0', appInfo.version)

    // 打包后真实下载能力（用本地合成的测试视频走 ffmpeg 抽取）
    const tmp = path.join(require('node:os').tmpdir(), 'aurora-tools-pkg-test.mp4')
    const outDir = path.join(require('node:os').tmpdir(), 'aurora-tools-pkg-out')
    fs.mkdirSync(outDir, { recursive: true })
    for (const f of fs.readdirSync(outDir)) {
      try {
        fs.unlinkSync(path.join(outDir, f))
      } catch {
        /* ignore */
      }
    }

    const { spawnSync } = require('node:child_process')
    if (!fs.existsSync(tmp)) {
      const r = spawnSync(
        path.join(appInfo.binDir, 'ffmpeg.exe'),
        ['-y', '-f', 'lavfi', '-i', 'color=c=teal:s=320x240:d=2',
         '-f', 'lavfi', '-i', 'sine=frequency=660:duration=2',
         '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
         '-c:a', 'aac', '-shortest', tmp],
        { encoding: 'utf-8', timeout: 120000 }
      )
    }
    check('用随包 ffmpeg 生成测试素材', fs.existsSync(tmp), `exit=${spawnSync(path.join(appInfo.binDir, 'ffmpeg.exe'), ['-version']).status}`)

    const res = JSON.parse(
      await evaluate(`window.tools.extractLocalAudio(${JSON.stringify({
        files: [tmp],
        format: 'mp3',
        bitrate: '192',
        outDir
      })}).then(r=>JSON.stringify(r))`)
    )
    check('打包后本地抽音轨成功', res[0]?.ok === true, res[0]?.error ?? res[0]?.output)

    // 拖放导入依赖的路径展开通道（新增 IPC）在打包后必须同样可用
    try {
      const dropDir = path.join(require('node:os').tmpdir(), 'aurora-pkg-dnd')
      fs.mkdirSync(path.join(dropDir, 'sub'), { recursive: true })
      fs.copyFileSync(tmp, path.join(dropDir, 'a.mp4'))
      fs.copyFileSync(tmp, path.join(dropDir, 'sub', 'b.mp4'))
      fs.writeFileSync(path.join(dropDir, 'skip.txt'), 'x', 'utf-8')
      // 传目录：应递归展开出 2 个媒体文件，并过滤掉 txt
      const expanded = JSON.parse(
        await evaluate(`window.tools.expandPaths(${JSON.stringify([dropDir])}).then(r=>JSON.stringify(r))`)
      )
      check(
        '打包后拖放路径展开可用（递归 + 过滤非媒体）',
        Array.isArray(expanded) && expanded.length === 2 && expanded.every((p) => p.endsWith('.mp4')),
        `${expanded.length} 个：${expanded.map((p) => path.basename(p)).join(', ')}`
      )
      fs.rmSync(dropDir, { recursive: true, force: true })
    } catch (e) {
      check('打包后拖放路径展开可用（递归 + 过滤非媒体）', false, String(e.message).slice(0, 160))
    }

    if (res[0]?.ok && fs.existsSync(res[0].output)) {
      const size = fs.statSync(res[0].output).size
      const probe = spawnSync(
        path.join(appInfo.binDir, 'ffprobe.exe'),
        ['-v', 'error', '-show_entries', 'stream=codec_name,duration', '-of', 'json', res[0].output],
        { encoding: 'utf-8', timeout: 30000 }
      )
      const stream = JSON.parse(probe.stdout || '{}').streams?.[0]
      check('打包产物为有效 mp3', stream?.codec_name === 'mp3', `codec=${stream?.codec_name} dur=${stream?.duration} size=${(size/1024).toFixed(0)}KB`)
      try { fs.unlinkSync(res[0].output) } catch { /* ignore */ }
    }

    // 解析能力（打包后同样应工作）。
    // 用本机 HTTP 直链喂给 yt-dlp 的 generic extractor：既验证了打包后的解析链路，
    // 又不依赖第三方站点的反爬状态（YouTube 等会随机"Failed to extract player response"，
    // 那是站点风控，和被验证的打包产物无关，不应让它把回归测试打成红灯）。
    let srv = null
    try {
      srv = http.createServer((req, res) => {
        try {
          const st = fs.statSync(tmp)
          res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': st.size })
          fs.createReadStream(tmp).pipe(res)
        } catch {
          res.writeHead(404).end()
        }
      })
      await new Promise((r) => srv.listen(0, '127.0.0.1', r))
      const port = srv.address().port
      const info = JSON.parse(
        await evaluate(`window.tools.probe("http://127.0.0.1:${port}/clip.mp4").then(r=>JSON.stringify(r))`)
      )
      check(
        '打包后解析链路可用（本地直链）',
        !!info.title && info.formats.length > 0,
        `title="${String(info.title).slice(0, 24)}" formats=${info.formats.length} extractor=${info.extractor ?? '?'}`
      )
    } catch (e) {
      check('打包后解析链路可用（本地直链）', false, String(e.message).slice(0, 160))
    } finally {
      if (srv) srv.close()
    }

    // 视频产物路径（S-06 回归）：本地 mkv + 容器 mp4 → 触发 mkv→mp4 转封装，
    // 断言任务记录的产物真实存在。这正是"下载完成但提示文件不存在"的场景。
    let vsrv = null
    try {
      const mkv = path.join(require('node:os').tmpdir(), 'aurora-pkg-test.mkv')
      if (!fs.existsSync(mkv)) {
        spawnSync(
          path.join(appInfo.binDir, 'ffmpeg.exe'),
          [
            '-y',
            '-f', 'lavfi', '-i', 'color=c=navy:s=320x240:d=2',
            '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
            '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-shortest', mkv
          ],
          { encoding: 'utf-8', timeout: 120000 }
        )
      }

      const outDir = path.join(require('node:os').tmpdir(), 'aurora-pkg-video-out')
      fs.rmSync(outDir, { recursive: true, force: true })
      fs.mkdirSync(outDir, { recursive: true })

      vsrv = http.createServer((req, res) => {
        try {
          const st = fs.statSync(mkv)
          res.writeHead(200, { 'Content-Type': 'video/x-matroska', 'Content-Length': st.size })
          fs.createReadStream(mkv).pipe(res)
        } catch {
          res.writeHead(404).end()
        }
      })
      await new Promise((r) => vsrv.listen(0, '127.0.0.1', r))
      const vport = vsrv.address().port

      await evaluate(`window.tools.setSettings(${JSON.stringify({ downloadDir: outDir, videoContainer: 'mp4' })})`)
      const jobId = await evaluate(
        `window.tools.createJob(${JSON.stringify({
          url: `http://127.0.0.1:${vport}/clip.mkv`,
          kind: 'video',
          formatId: '',
          title: 'clip',
          target: 'MP4'
        })})`
      )

      let job = null
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        const list = JSON.parse(await evaluate(`window.tools.listJobs().then(r=>JSON.stringify(r))`))
        job = list.find((j) => j.id === jobId)
        if (job && (job.status === 'done' || job.status === 'error')) break
      }

      const out = job?.outputPath ?? ''
      check(
        '打包后视频产物路径正确（转封装场景）',
        job?.status === 'done' && !!out && fs.existsSync(out) && /\.mp4$/i.test(out),
        `${job?.status} → ${out || '(空)'}`
      )
      if (out && fs.existsSync(out)) {
        check('打包后视频产物非空', fs.statSync(out).size > 0, `${(fs.statSync(out).size / 1024).toFixed(0)} KB`)
      }
    } catch (e) {
      check('打包后视频产物路径正确（转封装场景）', false, String(e.message).slice(0, 160))
    } finally {
      if (vsrv) vsrv.close()
    }

    // 设置读写
    const s1 = JSON.parse(await evaluate(`window.tools.getSettings().then(r=>JSON.stringify(r))`))
    check('设置读取', typeof s1.audioFormat === 'string', `audioFormat=${s1.audioFormat} concurrency=${s1.concurrency}`)
    const s2 = JSON.parse(await evaluate(`window.tools.setSettings({audioBitrate:"320"}).then(r=>JSON.stringify(r))`))
    check('设置写入并持久化', s2.audioBitrate === '320', `audioBitrate=${s2.audioBitrate}`)
    await evaluate(`window.tools.setSettings({audioBitrate:"192"})`)

    // 错误路径
    try {
      await evaluate(`window.tools.probe("not-a-url").then(r=>JSON.stringify(r))`)
      check('非法链接被拒绝', false, '未抛错')
    } catch (e) {
      check('非法链接被拒绝', /http:\/\/|https:\/\//.test(e.message), e.message.slice(0, 80))
    }
  } catch (e) {
    check('渲染层断言执行', false, e.message)
  }

  try {
    child.kill()
  } catch {
    /* ignore */
  }
  await new Promise((r) => setTimeout(r, 1500))
  finish()
}

function cdpGet(p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: p, timeout: 4000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => resolve(d))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

function connectWs(url, onMessage) {
  return new Promise((resolve, reject) => {
    const WebSocket = require('ws')
    const ws = new WebSocket(url, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 })
    ws.on('open', () => resolve(ws))
    ws.on('message', (d) => {
      try {
        onMessage(JSON.parse(d.toString()))
      } catch {
        /* ignore */
      }
    })
    ws.on('error', reject)
  })
}

function finish() {
  const failed = results.filter((r) => !r.ok)
  console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`)
  if (failed.length) console.log('失败项: ' + failed.map((f) => f.name).join(', '))
  fs.writeFileSync(
    path.join(ROOT, `verify-packaged-${MODE}.json`),
    JSON.stringify(results, null, 2)
  )
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((e) => {
  check('验证脚本执行', false, e.message)
  finish()
})
