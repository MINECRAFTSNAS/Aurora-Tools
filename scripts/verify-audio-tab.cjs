/**
 * 专项验证「仅音频」标签页里的格式/比特率选择（用户反馈问题 1）。
 *
 * 该区域的组件只在解析出媒体信息后才渲染，因此这里用本地 HTTP 服务
 * 提供一个真实视频直链，让 yt-dlp 走 generic extractor 解析 —— 全程不依赖外网，
 * 也不受视频站点风控影响。
 *
 * 用法：node scripts/verify-audio-tab.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const http = require('node:http')

const ROOT = path.resolve(__dirname, '..')
const CDP_PORT = 9693
const WEB_PORT = 9703
const EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail: String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`)
}

function cdpGet(p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: CDP_PORT, path: p, timeout: 4000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => resolve(d))
    })
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('timeout'))
    })
  })
}

function connectWs(url, onMessage) {
  return new Promise((resolve, reject) => {
    const WebSocket = require('ws')
    const ws = new WebSocket(url, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 })
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

/** 用随包 ffmpeg 生成测试素材（若尚未存在） */
function makeMedia() {
  const dir = path.join(os.tmpdir(), 'aurora-audiotab')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'clip.mp4')
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) return file

  const { spawnSync } = require('node:child_process')
  spawnSync(
    path.join(ROOT, 'resources', 'bin', 'ffmpeg.exe'),
    [
      '-y',
      '-f', 'lavfi', '-i', 'color=c=teal:s=320x240:d=2',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-shortest', file
    ],
    { encoding: 'utf-8', timeout: 120000 }
  )
  return file
}

function serve(file) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        const st = fs.statSync(file)
        res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': st.size })
        fs.createReadStream(file).pipe(res)
      } catch {
        res.writeHead(404).end()
      }
    })
    server.listen(WEB_PORT, '127.0.0.1', () => resolve(server))
  })
}

async function main() {
  const media = makeMedia()
  check('生成测试视频素材', fs.existsSync(media), `${(fs.statSync(media).size / 1024).toFixed(0)} KB`)
  const server = await serve(media)

  const { spawn } = require('node:child_process')
  const child = spawn(EXE, [`--remote-debugging-port=${CDP_PORT}`, '.'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'))
  })

  let target = null
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    try {
      const pages = JSON.parse(await cdpGet('/json/list')).filter((p) => p.type === 'page')
      if (pages.length) {
        target = pages[0]
        break
      }
    } catch {
      /* not ready */
    }
    if (child.exitCode !== null) break
  }
  if (!target) {
    check('应用启动', false, `exit=${child.exitCode}`)
    server.close()
    return finish()
  }

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
        } else resolve(msg.result?.result?.value)
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

  for (let i = 0; i < 40; i++) {
    if (await evaluate(`!!document.querySelector('.probe')`).catch(() => false)) break
    await new Promise((r) => setTimeout(r, 400))
  }

  /* ---- 解析本地直链，让「仅音频」标签页真正渲染出来 ---- */
  const url = `http://127.0.0.1:${WEB_PORT}/clip.mp4`
  let info = null
  try {
    info = JSON.parse(await evaluate(`window.tools.probe(${JSON.stringify(url)}).then(r=>JSON.stringify(r))`))
    check('本地直链解析成功', !!info.title, `title="${info.title}" formats=${info.formats?.length ?? 0}`)
  } catch (e) {
    check('本地直链解析成功', false, String(e.message).slice(0, 200))
  }

  // 把解析结果灌进界面：直接点输入框旁的解析按钮
  await evaluate(`(() => {
    const input = document.querySelector('.probe__input')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(url)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await new Promise((r) => setTimeout(r, 250))
  await evaluate(`document.querySelector('.probe__input-row button[type=submit]')?.click()`)

  // 等 mediainfo 出现
  let ready = false
  for (let i = 0; i < 50; i++) {
    ready = await evaluate(`!!document.querySelector('.mediainfo')`).catch(() => false)
    if (ready) break
    await new Promise((r) => setTimeout(r, 600))
  }
  check('界面展示解析结果（mediainfo 出现）', ready)

  /* ---- 切到「仅音频」 ---- */
  const switched = await evaluate(`(() => {
    const btn = Array.from(document.querySelectorAll('.segment__item')).find(b => /仅音频/.test(b.textContent||''))
    if (!btn) return false
    btn.click()
    return true
  })()`)
  await new Promise((r) => setTimeout(r, 500))
  check('可切换到「仅音频」标签页', switched === true)

  const audioUi = await evaluate(`JSON.stringify({
    hasAudiopick: !!document.querySelector('.audiopick'),
    hasDropdown: !!document.querySelector('.audiopick .dd'),
    value: (document.querySelector('.audiopick .dd .dd__value')?.textContent||'').trim(),
    bitrates: Array.from(document.querySelectorAll('.audiopick .segment .segment__item')).map(b=>(b.textContent||'').trim())
  })`)
  const A = JSON.parse(audioUi)
  check('「仅音频」区域渲染出格式下拉框', A.hasAudiopick && A.hasDropdown, `当前=${A.value}`)
  check('比特率选项存在', A.bitrates.length > 0, A.bitrates.join(','))

  /* ---- 核心：在音频标签页里改格式，必须立即生效（无需重启） ---- */
  const before = await evaluate(`window.tools.getSettings().then(s => s.audioFormat)`)
  const changed = await evaluate(`(async () => {
    const dd = document.querySelector('.audiopick .dd')
    if (!dd) return 'no-dd'
    dd.click()
    await new Promise(r=>setTimeout(r,200))
    const items = Array.from(document.querySelectorAll('.dd__panel .dd__item'))
    const target = items.find(i => /FLAC/.test(i.textContent||''))
    if (!target) return 'no-flac'
    target.click()
    await new Promise(r=>setTimeout(r,350))
    return JSON.stringify({
      label: (document.querySelector('.audiopick .dd .dd__value')?.textContent||'').trim(),
      panelClosed: !document.querySelector('.dd__panel'),
      bitrateVisible: document.querySelectorAll('.audiopick .segment .segment__item').length
    })
  })()`)
  let R
  try {
    R = JSON.parse(changed)
  } catch {
    R = { error: changed }
  }
  const after = await evaluate(`window.tools.getSettings().then(s => s.audioFormat)`)

  check('音频标签页格式选择器可交互', !R.error, R.error ?? `原值=${before}`)
  check('选择后主进程设置立即更新（无需重启）', after === 'flac', `当前=${after}`)
  check('界面标签立即更新', /FLAC/.test(R.label || ''), R.label || '')
  check('浮层选完自动收起', R.panelClosed === true)
  check('切换为无损格式后比特率选项自动隐藏', R.bitrateVisible === 0, `剩 ${R.bitrateVisible} 个`)

  /* ---- 换回 MP3，验证比特率可改 ---- */
  const back = await evaluate(`(async () => {
    const dd = document.querySelector('.audiopick .dd')
    dd.click(); await new Promise(r=>setTimeout(r,200))
    Array.from(document.querySelectorAll('.dd__panel .dd__item')).find(i=>/^MP3$/.test((i.textContent||'').trim()))?.click()
    await new Promise(r=>setTimeout(r,400))
    const segs = Array.from(document.querySelectorAll('.audiopick .segment .segment__item'))
    const b320 = segs.find(s => (s.textContent||'').trim() === '320k')
    if (b320) b320.click()
    await new Promise(r=>setTimeout(r,350))
    const pressed = segs.filter(s => s.getAttribute('aria-pressed') === 'true').map(s=>(s.textContent||'').trim())
    return JSON.stringify({ count: segs.length, pressed })
  })()`)
  const BK = JSON.parse(back)
  const bitrateNow = await evaluate(`window.tools.getSettings().then(s => s.audioBitrate)`)
  check('换回 MP3 后比特率选项重新出现', BK.count === 4, `${BK.count} 个`)
  check('比特率点选后立即生效', bitrateNow === '320' && BK.pressed.includes('320k'), `audioBitrate=${bitrateNow} 选中=${BK.pressed.join(',')}`)

  child.kill()
  server.close()
  await new Promise((r) => setTimeout(r, 1200))
  finish()
}

function finish() {
  const failed = results.filter((r) => !r.ok)
  console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`)
  if (failed.length) console.log('失败项: ' + failed.map((f) => f.name).join(', '))
  fs.writeFileSync(path.join(ROOT, 'verify-audio-tab.json'), JSON.stringify(results, null, 2))
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((e) => {
  check('验证脚本', false, e.message)
  finish()
})
