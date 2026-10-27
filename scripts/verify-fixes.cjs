/**
 * 针对用户反馈的 4 个 Tools 问题的回归验证。
 *
 * 用法：node scripts/verify-fixes.cjs
 *
 * 断言全部基于真实运行的应用（CDP 连接真实渲染进程），
 * 不依赖"看起来对"，而是检查 DOM 状态、计算样式与元素命中测试。
 */
const path = require('node:path')
const fs = require('node:fs')
const http = require('node:http')

const ROOT = path.resolve(__dirname, '..')
const PORT = 9688
const EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail: String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`)
}

function cdpGet(p) {
  return new Promise((resolve, reject) => {
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

async function main() {
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
      }, 60000)
    })

  // 等渲染层挂载
  for (let i = 0; i < 40; i++) {
    if (await evaluate(`!!document.querySelector('.probe')`).catch(() => false)) break
    await new Promise((r) => setTimeout(r, 400))
  }

  /* ============ 问题 2：本地提取必须常驻（无需先解析 URL） ============ */
  const local = await evaluate(`JSON.stringify({
    hasLocal: !!document.querySelector('.local'),
    hasPickerBtn: !!Array.from(document.querySelectorAll('.local .btn')).find(b => /选择视频文件/.test(b.textContent||'')),
    hint: (document.querySelector('.probe__divider')?.textContent || '').trim(),
    // 此时尚未解析任何链接
    hasMediaInfo: !!document.querySelector('.mediainfo')
  })`)
  const L = JSON.parse(local)
  check('本地提取区块在未解析时即存在', L.hasLocal, L.hasLocal ? '已渲染' : '缺失')
  check('本地提取的「选择视频文件」按钮可用', L.hasPickerBtn)
  check('本地提取带有独立分隔标题', /本地视频提取音频/.test(L.hint), L.hint)
  check('确认此时确实没有解析结果（前提成立）', L.hasMediaInfo === false)

  /* ============ 问题 1：格式/比特率选择立即生效，无需重启 ============ */
  // 打开常驻的本地提取下拉框
  const opened = await evaluate(`(() => {
    const dd = document.querySelector('.local .dd')
    if (!dd) return 'no-dd'
    dd.click()
    return 'clicked'
  })()`)
  await new Promise((r) => setTimeout(r, 300))
  const panelInfo = await evaluate(`JSON.stringify({
    exists: !!document.querySelector('.dd__panel'),
    items: document.querySelectorAll('.dd__panel .dd__item').length,
    zIndex: document.querySelector('.dd__panel') ? getComputedStyle(document.querySelector('.dd__panel')).zIndex : '',
    position: document.querySelector('.dd__panel') ? getComputedStyle(document.querySelector('.dd__panel')).position : ''
  })`)
  const P = JSON.parse(panelInfo)
  check('下拉框可展开', opened === 'clicked' && P.exists, `${P.items} 个选项`)
  // 浮层 99998、提示层 99999：都远高于页面其余内容
  check(
    '下拉浮层用 fixed 定位且高层级（不会被背景压住）',
    P.position === 'fixed' && Number(P.zIndex) >= 99998,
    `position=${P.position} z-index=${P.zIndex}`
  )

  // 浮层命中测试：面板中心点最顶层元素必须属于面板
  const hit = await evaluate(`(() => {
    const panel = document.querySelector('.dd__panel')
    if (!panel) return 'no-panel'
    const r = panel.getBoundingClientRect()
    const el = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2)
    return panel.contains(el) ? 'panel-on-top' : ('covered-by:' + (el?.className || el?.tagName || '?'))
  })()`)
  check('浮层确实位于最上层（命中测试）', hit === 'panel-on-top', hit)

  // 选择 FLAC（第 3 项），验证标签立即更新 + 主进程设置同步
  const before = await evaluate(`window.tools.getSettings().then(s => s.audioFormat)`)
  const picked = await evaluate(`(() => {
    const items = Array.from(document.querySelectorAll('.dd__panel .dd__item'))
    const flac = items.find(i => /FLAC/.test(i.textContent || ''))
    if (!flac) return 'no-flac-option'
    flac.click()
    return 'picked'
  })()`)
  await new Promise((r) => setTimeout(r, 400))
  const after = await evaluate(`window.tools.getSettings().then(s => s.audioFormat)`)
  const labelNow = await evaluate(`(document.querySelector('.local .dd .dd__value')?.textContent || '').trim()`)
  check('在下拉框里选中 FLAC', picked === 'picked', `原设置=${before}`)
  check('主进程设置已更新（无需重启）', after === 'flac', `现在=${after}`)
  check('UI 标签立即跟随（不是重启后才变）', /FLAC/.test(labelNow), labelNow)
  check('浮层选完后自动关闭', (await evaluate(`!document.querySelector('.dd__panel')`)) === true)

  // 比特率按钮：FLAC 属于无损，应先隐藏比特率；换成 MP3 后应出现并可切换
  const bitrateFlow = await evaluate(`(async () => {
    const open = () => document.querySelector('.local .dd').click()
    const pick = (re) => {
      const it = Array.from(document.querySelectorAll('.dd__panel .dd__item')).find(i => re.test(i.textContent||''))
      if (!it) return false
      it.click(); return true
    }
    open(); await new Promise(r=>setTimeout(r,150)); pick(/^MP3$/); 
    await new Promise(r=>setTimeout(r,300))
    const segs = Array.from(document.querySelectorAll('.local .segment .segment__item'))
    const labels = segs.map(s => (s.textContent||'').trim())
    const target = segs.find(s => (s.textContent||'').trim() === '320k')
    if (target) target.click()
    await new Promise(r=>setTimeout(r,350))
    const bitrate = await window.tools.getSettings().then(s => s.audioBitrate)
    const pressed = Array.from(document.querySelectorAll('.local .segment .segment__item'))
      .filter(s => s.getAttribute('aria-pressed') === 'true')
      .map(s => (s.textContent||'').trim())
    return JSON.stringify({ labels, bitrate, pressed })
  })()`)
  const B = JSON.parse(bitrateFlow)
  check('切到 MP3 后比特率选项出现', B.labels.includes('320k'), B.labels.join(','))
  check('点选 320k 后主进程设置立即更新', B.bitrate === '320', `audioBitrate=${B.bitrate}`)
  check('比特率按钮选中态立即反映（无需重启）', B.pressed.includes('320k'), `选中=${B.pressed.join(',')}`)

  /* ============ 问题 3：下拉框在设置面板里也不被遮挡 ============ */
  const settingsDd = await evaluate(`(async () => {
    // 打开设置面板
    const btn = Array.from(document.querySelectorAll('.titlebar__actions .icon-btn'))[0]
    if (!btn) return 'no-settings-btn'
    btn.click()
    await new Promise(r=>setTimeout(r,350))
    const dd = document.querySelector('.settings .dd')
    if (!dd) return 'no-dd-in-settings'
    dd.click()
    await new Promise(r=>setTimeout(r,250))
    const panel = document.querySelector('.dd__panel')
    if (!panel) return 'no-panel'
    const r = panel.getBoundingClientRect()
    const el = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2)
    const topmost = panel.contains(el)
    // 面板是否完整落在视口内
    const inView = r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth
    // 关闭
    document.querySelector('.settings__head .icon-btn')?.click()
    return JSON.stringify({ topmost, inView, z: getComputedStyle(panel).zIndex })
  })()`)
  const S = JSON.parse(settingsDd)
  check('设置面板内下拉框可展开', typeof S === 'object', typeof S === 'string' ? S : '')
  if (typeof S === 'object') {
    check('设置面板下拉浮层在最上层', S.topmost === true)
    check('浮层完整位于视口内（未被裁切）', S.inView === true)
  }

  /* ============ 问题 4：窗口按钮不重复（frameless） ============ */
  const chromeInfo = await evaluate(`JSON.stringify({
    captionBtns: document.querySelectorAll('.caption-btn').length,
    hasTitlebar: !!document.querySelector('.titlebar'),
    outerInnerDiff: window.outerHeight - window.innerHeight,
    inner: window.innerHeight
  })`)
  const C = JSON.parse(chromeInfo)
  check('自绘窗口按钮恰好 3 个', C.captionBtns === 3, `${C.captionBtns} 个`)
  // 有系统原生标题栏时，outerHeight - innerHeight 约为标题栏高度(39px左右)
  check('无系统原生标题栏（frameless 生效）', Math.abs(C.outerInnerDiff) <= 2, `outer-inner=${C.outerInnerDiff}px`)

  /* ============ 悬停提示（Tools 侧同样受益） ============ */
  // 注意：提示层是 pointer-events:none，elementFromPoint 永远拿不到它，
  // 因此这里用「存在 + 文案 + 视口内 + 高层级 + 定位为 fixed」来判定。
  const tip = await evaluate(`(async () => {
    const el = document.querySelector('[data-tip="设置"]') || document.querySelector('.statusdot')
    if (!el) return 'no-el'
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await new Promise(r=>setTimeout(r,400))
    const t = document.querySelector('.aurora-tooltip')
    if (!t) return 'no-tooltip'
    const r = t.getBoundingClientRect()
    const cs = getComputedStyle(t)
    return JSON.stringify({
      text: (t.textContent||'').trim(),
      z: cs.zIndex,
      pos: cs.position,
      pointerEvents: cs.pointerEvents,
      inView: r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth,
      nonZero: r.width > 0 && r.height > 0,
      inBody: t.parentElement === document.body
    })
  })()`)
  const T = JSON.parse(tip)
  check(
    '悬停提示可显示（portal 挂在 body 上）',
    typeof T === 'object' && T.inBody === true && T.nonZero === true,
    typeof T === 'object' ? `"${T.text}"` : T
  )
  check(
    '悬停提示层级最高且完整可见',
    typeof T === 'object' && T.pos === 'fixed' && Number(T.z) >= 99999 && T.inView === true,
    typeof T === 'object' ? `z=${T.z} pos=${T.pos} inView=${T.inView}` : T
  )

  child.kill()
  await new Promise((r) => setTimeout(r, 1200))
  finish()
}

function finish() {
  const failed = results.filter((r) => !r.ok)
  console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`)
  if (failed.length) console.log('失败项: ' + failed.map((f) => f.name).join(', '))
  fs.writeFileSync(path.join(ROOT, 'verify-fixes.json'), JSON.stringify(results, null, 2))
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((e) => {
  check('验证脚本', false, e.message)
  finish()
})
