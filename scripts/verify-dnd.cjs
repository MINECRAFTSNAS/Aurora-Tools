/**
 * 验证 Tools 的拖放导入。
 *
 * 覆盖三条路径：
 *   1) 拖入视频文件 → 进入「本地提取」待处理列表
 *   2) 拖入文件夹 → 递归展开出其中的媒体文件
 *   3) 拖入 http(s) 文本 → 自动填入输入框并解析
 *
 * 用法: node scripts/verify-dnd.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const http = require('node:http')

const ROOT = path.resolve(__dirname, '..')
const PORT = 9696
const WEB_PORT = 9704
const EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const FFMPEG = path.join(ROOT, 'resources', 'bin', 'ffmpeg.exe')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail: String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`)
}

const cdpGet = (p) =>
  new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: p, timeout: 4000 }, (res) => {
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

const connectWs = (url, onMessage) =>
  new Promise((resolve, reject) => {
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

/** 生成测试用 mp4（带音轨）与一个干扰用的非媒体文件 */
function makeMedia() {
  const dir = path.join(os.tmpdir(), 'aurora-tools-dnd')
  fs.mkdirSync(dir, { recursive: true })
  const { spawnSync } = require('node:child_process')

  const mk = (file, freq) => {
    if (fs.existsSync(file) && fs.statSync(file).size > 1000) return file
    spawnSync(
      FFMPEG,
      [
        '-y', '-f', 'lavfi', '-i', 'color=c=navy:s=320x240:d=2',
        '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=2`,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-shortest', file
      ],
      { encoding: 'utf-8', timeout: 120000 }
    )
    return file
  }

  const a = mk(path.join(dir, 'drop-one.mp4'), 440)
  const b = mk(path.join(dir, 'drop-two.mp4'), 660)

  // 文件夹场景：内含 1 个媒体 + 1 个非媒体（应被过滤）
  const folder = path.join(dir, 'batch')
  fs.mkdirSync(path.join(folder, 'nested'), { recursive: true })
  mk(path.join(folder, 'in-folder.mp4'), 550)
  mk(path.join(folder, 'nested', 'deep.mp4'), 770)
  fs.writeFileSync(path.join(folder, 'readme.txt'), 'not a media file', 'utf-8')

  return { dir, a, b, folder }
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
  const M = makeMedia()
  check('生成测试素材', fs.existsSync(M.a) && fs.existsSync(M.b), 'drop-one.mp4 / drop-two.mp4')
  check('生成测试文件夹', fs.existsSync(path.join(M.folder, 'nested', 'deep.mp4')), 'batch/（含 txt 干扰项）')

  const server = await serve(M.a)

  const { spawn } = require('node:child_process')
  const child = spawn(EXE, [`--remote-debugging-port=${PORT}`, '.'], {
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
  const send = (method, params) =>
    new Promise((resolve, reject) => {
      const myId = ++id
      pending.set(myId, (msg) => {
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else resolve(msg.result)
      })
      ws.send(JSON.stringify({ id: myId, method, params }))
      setTimeout(() => {
        if (pending.has(myId)) {
          pending.delete(myId)
          reject(new Error('timeout ' + method))
        }
      }, 90000)
    })
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
    return r.result?.value
  }

  for (let i = 0; i < 40; i++) {
    if (await evaluate(`!!document.querySelector('.local')`).catch(() => false)) break
    await new Promise((r) => setTimeout(r, 400))
  }

  const size = JSON.parse(await evaluate(`JSON.stringify({w: window.innerWidth, h: window.innerHeight})`))
  const cx = Math.round(size.w / 2)
  const cy = Math.round(size.h / 2)

  const dropFiles = async (files) => {
    const data = { items: [], files, dragOperationsMask: 1 }
    await send('Input.dispatchDragEvent', { type: 'dragEnter', x: cx, y: cy, data })
    await new Promise((r) => setTimeout(r, 250))
    await send('Input.dispatchDragEvent', { type: 'dragOver', x: cx, y: cy, data })
    await new Promise((r) => setTimeout(r, 150))
    await send('Input.dispatchDragEvent', { type: 'drop', x: cx, y: cy, data })
  }

  /* ---------- 1) 拖入两个视频文件 ---------- */
  const before = await evaluate(`document.querySelectorAll('.local__item').length`)
  await dropFiles([M.a, M.b])
  await new Promise((r) => setTimeout(r, 2000))
  const afterFiles = JSON.parse(
    await evaluate(`JSON.stringify({
      items: document.querySelectorAll('.local__item').length,
      names: Array.from(document.querySelectorAll('.local__item .local__name')).map(e=>(e.textContent||'').trim()),
      overlayGone: !document.querySelector('.dropzone')
    })`)
  )
  check('拖入时遮罩出现后消失', afterFiles.overlayGone === true)
  check('两个视频进入待提取列表', afterFiles.items - before === 2, `${before} → ${afterFiles.items}`)
  check(
    '文件名正确显示',
    afterFiles.names.includes('drop-one.mp4') && afterFiles.names.includes('drop-two.mp4'),
    afterFiles.names.join(', ')
  )

  /* ---------- 2) 拖入文件夹（递归 + 过滤非媒体） ---------- */
  await dropFiles([M.folder])
  await new Promise((r) => setTimeout(r, 2200))
  const afterFolder = JSON.parse(
    await evaluate(`JSON.stringify({
      items: document.querySelectorAll('.local__item').length,
      names: Array.from(document.querySelectorAll('.local__item .local__name')).map(e=>(e.textContent||'').trim())
    })`)
  )
  check('文件夹被递归展开', afterFolder.items - afterFiles.items === 2, `新增 ${afterFolder.items - afterFiles.items} 个（in-folder.mp4 + nested/deep.mp4）`)
  check('深层文件也被找到', afterFolder.names.includes('deep.mp4'))
  check('非媒体文件被过滤', !afterFolder.names.includes('readme.txt'))

  /* ---------- 3) 拖入链接文本 ---------- */
  const url = `http://127.0.0.1:${WEB_PORT}/clip.mp4`
  const urlData = { items: [{ mimeType: 'text/plain', data: url }], dragOperationsMask: 1 }
  await send('Input.dispatchDragEvent', { type: 'dragEnter', x: cx, y: cy, data: urlData })
  await new Promise((r) => setTimeout(r, 200))
  await send('Input.dispatchDragEvent', { type: 'drop', x: cx, y: cy, data: urlData })
  await new Promise((r) => setTimeout(r, 6000))

  const afterUrl = JSON.parse(
    await evaluate(`JSON.stringify({
      input: (document.querySelector('.probe__input')?.value || '').trim(),
      hasMediaInfo: !!document.querySelector('.mediainfo'),
      title: (document.querySelector('.mediainfo__title')?.textContent || '').trim()
    })`)
  )
  check('拖入链接自动填入输入框', afterUrl.input === url, afterUrl.input || '(空)')
  check('拖入链接自动完成解析', afterUrl.hasMediaInfo === true, afterUrl.title || '未出现结果')

  /* ---------- 4) 真实执行一次提取，确认拖入的文件可用 ---------- */
  const runResult = await evaluate(`(async () => {
    const btn = Array.from(document.querySelectorAll('.local__actions .btn')).find(b=>/提取音频/.test(b.textContent||''))
    if (!btn) return 'no-button'
    btn.click()
    return 'clicked'
  })()`)
  check('待提取列表可执行提取', runResult === 'clicked')

  let done = null
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    const st = JSON.parse(
      await evaluate(`JSON.stringify({
        results: document.querySelectorAll('.local__result').length,
        ok: document.querySelectorAll('.local__result.is-ok').length,
        names: Array.from(document.querySelectorAll('.local__result .local__name')).map(e=>(e.textContent||'').trim())
      })`)
    )
    if (st.results >= 4) {
      done = st
      break
    }
  }
  check(
    '拖入的 4 个文件都成功产出音频',
    done?.ok === 4,
    done ? `成功 ${done.ok}/${done.results}：${done.names.join(', ')}` : '未在超时内完成'
  )

  child.kill()
  server.close()
  await new Promise((r) => setTimeout(r, 1200))
  finish()
}

function finish() {
  const failed = results.filter((r) => !r.ok)
  console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`)
  if (failed.length) console.log('失败项: ' + failed.map((f) => f.name).join(', '))
  fs.writeFileSync(path.join(ROOT, 'verify-dnd.json'), JSON.stringify(results, null, 2))
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((e) => {
  check('验证脚本', false, e.message)
  finish()
})
