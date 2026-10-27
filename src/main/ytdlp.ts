/**
 * yt-dlp / ffmpeg 子进程封装。
 *
 * 设计要点：
 * - 二进制随应用分发，放在 resources/bin 下，打包后通过 process.resourcesPath 定位
 * - yt-dlp 用 --newline 让进度逐行输出，按行解析 [download] 进度
 * - 统一走 UTF-8，避免中文标题在 GBK 控制台环境下乱码
 * - 每个任务持有自己的子进程引用，支持取消
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, promises as fsp } from 'node:fs'
import { join } from 'node:path'

export interface BinPaths {
  binDir: string
  ytdlp: string
  ffmpeg: string
  ffprobe: string
}

/**
 * 解析二进制目录。
 * 开发态用仓库里的 resources/bin；打包后 electron-builder 会把该目录
 * 复制到 resources/bin，故用 process.resourcesPath 拼接。
 */
export function resolveBinDir(appPath: string, isPackaged: boolean): BinPaths {
  const candidates = isPackaged
    ? [join(process.resourcesPath, 'bin')]
    : [join(appPath, 'resources', 'bin'), join(appPath, '..', 'resources', 'bin')]

  const binDir = candidates.find((d) => existsSync(d)) ?? candidates[0]
  return {
    binDir,
    ytdlp: join(binDir, 'yt-dlp.exe'),
    ffmpeg: join(binDir, 'ffmpeg.exe'),
    ffprobe: join(binDir, 'ffprobe.exe')
  }
}

/** 运行一个进程并收集全部输出（用于 --version、-J 等一次性命令） */
export function runCapture(
  exe: string,
  args: string[],
  opts: { timeoutMs?: number; cwd?: string } = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(exe, args, {
      cwd: opts.cwd,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          if (!settled) {
            try {
              child.kill()
            } catch {
              /* ignore */
            }
          }
        }, opts.timeoutMs)
      : null

    child.stdout.setEncoding('utf-8')
    child.stderr.setEncoding('utf-8')
    child.stdout.on('data', (d: string) => {
      stdout += d
      // 防止异常输出撑爆内存
      if (stdout.length > 32 * 1024 * 1024) stdout = stdout.slice(-16 * 1024 * 1024)
    })
    child.stderr.on('data', (d: string) => {
      stderr += d
      if (stderr.length > 4 * 1024 * 1024) stderr = stderr.slice(-2 * 1024 * 1024)
    })

    const done = (code: number): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({ code, stdout, stderr })
    }

    child.on('error', (err) => {
      stderr += `\n[spawn error] ${err.message}`
      done(-1)
    })
    child.on('close', (code) => done(code ?? -1))
  })
}

export interface SpawnOptions {
  cwd?: string
  /** 逐行回调（stdout + stderr 合并，yt-dlp 的进度走 stderr） */
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void
  onExit?: (code: number) => void
  env?: NodeJS.ProcessEnv
}

export interface SpawnHandle {
  child: ChildProcessWithoutNullStreams
  /** 主动结束（Windows 上子进程可能还有 ffmpeg 孙子进程） */
  kill: () => void
}

/** 启动一个带逐行输出的长任务 */
export function spawnStream(exe: string, args: string[], opts: SpawnOptions = {}): SpawnHandle {
  const child = spawn(exe, args, {
    cwd: opts.cwd,
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', ...opts.env }
  })

  const pump = (stream: NodeJS.ReadableStream, name: 'stdout' | 'stderr'): void => {
    let buf = ''
    stream.setEncoding('utf-8')
    stream.on('data', (chunk: string) => {
      buf += chunk
      // yt-dlp 的进度行用 \r 刷新，需要同时按 \r 和 \n 切分
      const parts = buf.split(/\r\n|\r|\n/)
      buf = parts.pop() ?? ''
      for (const line of parts) {
        if (line.trim()) opts.onLine?.(line, name)
      }
      // 兜底：超长无换行输出
      if (buf.length > 65536) {
        opts.onLine?.(buf.slice(0, 4096), name)
        buf = ''
      }
    })
    stream.on('end', () => {
      if (buf.trim()) opts.onLine?.(buf, name)
    })
  }

  pump(child.stdout, 'stdout')
  pump(child.stderr, 'stderr')

  let killed = false
  child.on('close', (code) => {
    if (!killed) opts.onExit?.(code ?? -1)
  })
  child.on('error', (err) => {
    opts.onLine?.(`[spawn error] ${err.message}`, 'stderr')
    if (!killed) opts.onExit?.(-1)
  })

  return {
    child,
    kill: () => {
      killed = true
      if (process.platform === 'win32' && child.pid) {
        // 用 taskkill 连同 ffmpeg 子进程一起结束，避免残留进程占用文件
        try {
          spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
        } catch {
          /* ignore */
        }
      } else {
        try {
          child.kill('SIGTERM')
        } catch {
          /* ignore */
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * 进度解析
 * ------------------------------------------------------------------ */

export interface DownloadProgress {
  percent: number
  downloaded: number
  total: number
  speed: string
  eta: string
}

const SIZE_UNITS: Record<string, number> = {
  B: 1,
  KIB: 1024,
  MIB: 1024 ** 2,
  GIB: 1024 ** 3,
  TIB: 1024 ** 4,
  KB: 1000,
  MB: 1000 ** 2,
  GB: 1000 ** 3,
  TB: 1000 ** 4
}

/** 把 yt-dlp 的 "3.24MiB" / "1.20GiB" 转成字节数 */
export function parseSize(text: string): number {
  const m = /^([\d.]+)\s*([KMGTP]?i?B)$/i.exec(text.trim())
  if (!m) return 0
  const value = Number.parseFloat(m[1])
  if (!Number.isFinite(value)) return 0
  return Math.round(value * (SIZE_UNITS[m[2].toUpperCase()] ?? 1))
}

/**
 * 解析 yt-dlp 的下载进度行。典型形态：
 *   [download]  45.2% of  120.35MiB at    3.24MiB/s ETA 00:21
 *   [download] 100% of 5.10MiB in 00:02
 *   [download]   1.2% of ~  4.00MiB at  未知 B/s ETA 未知
 */
export function parseDownloadLine(line: string): DownloadProgress | null {
  if (!line.includes('[download]')) return null
  const body = line.slice(line.indexOf('[download]') + '[download]'.length).trim()

  // 跳过 "Destination:" / "已合并" 之类的信息行
  const pctMatch = /(\d+(?:\.\d+)?)%/.exec(body)
  if (!pctMatch) return null

  const percent = Number.parseFloat(pctMatch[1])
  if (!Number.isFinite(percent)) return null

  // 总量：可能带 ~ 前缀表示估算值
  const ofMatch = /of\s+~?\s*([\d.]+\s*[KMGTP]?i?B)/i.exec(body)
  const total = ofMatch ? parseSize(ofMatch[1]) : 0

  const atMatch = /at\s+~?\s*([\d.]+\s*[KMGTP]?i?B\/s|未知\s*B\/s|Unknown\s*B\/s)/i.exec(body)
  const speed = atMatch ? atMatch[1].replace(/\s+/g, '') : ''

  const etaMatch = /ETA\s+([\d:]+|未知|Unknown)/i.exec(body)
  const eta = etaMatch ? etaMatch[1] : ''

  const downloaded = total > 0 ? Math.round((percent / 100) * total) : 0

  return { percent: Math.max(0, Math.min(100, percent)), downloaded, total, speed, eta }
}

/** 判断一行是否表示进入后处理（合并/转封装/转码）阶段 */
export function isPostProcessLine(line: string): boolean {
  return (
    line.includes('[Merger]') ||
    line.includes('[ExtractAudio]') ||
    line.includes('[VideoRemuxer]') ||
    line.includes('[VideoConvertor]') ||
    line.includes('[ffmpeg]') ||
    line.includes('[FixupM3u8]') ||
    line.includes('[FixupM4a]') ||
    line.includes('[Metadata]') ||
    line.includes('[ThumbnailsConvertor]') ||
    line.includes('[EmbedThumbnail]')
  )
}

/**
 * 从 yt-dlp 输出里提取最终产物路径。
 *
 * 注意最终路径可能经过多次改写，必须跟上最后一步：
 *   [download] Destination: ...x.f137.mp4        ← 中间文件，合并后会被删
 *   [Merger] Merging formats into "...x.mkv"      ← 合并产物，remux 后也会被删
 *   [VideoRemuxer] ... Destination: ...x.mp4      ← 真正的最终文件
 * 只认前两类的话，任务里保存的就是一个已被删除的中间文件，
 * 表现为"下载完成但提示文件不存在"。
 */
export function parseDestination(line: string): string | null {
  const dl = /\[download\]\s+Destination:\s*(.+)$/.exec(line)
  if (dl) return dl[1].trim()

  // [Merger] Merging formats into "path"（可能带引号也可能不带）
  const merger = /\[Merger\]\s+Merging formats into\s+"?([^"]+?)"?\s*$/.exec(line)
  if (merger) return merger[1].trim()

  // 各类后处理器统一形如 "... Destination: path"
  const post =
    /\[(?:ExtractAudio|VideoRemuxer|VideoConvertor|FixupM3u8|FixupM4a|MoveFiles)\][^\r\n]*?Destination:\s*(.+)$/.exec(
      line
    )
  if (post) return post[1].replace(/^"|"$/g, '').trim()

  // 已存在的文件：yt-dlp 会打印 "has already been downloaded"
  const already = /\[download\]\s+(.+?)\s+has already been downloaded/.exec(line)
  if (already) return already[1].trim()

  return null
}

/** 把 yt-dlp 的错误输出整理成一句人话 */
export function humanizeError(stderr: string): string {
  const lines = stderr.split(/\r?\n/).filter(Boolean)
  const errLine = lines.find((l) => l.startsWith('ERROR:')) ?? lines.find((l) => l.includes('ERROR'))
  if (!errLine) return '未知错误，请查看日志'

  const msg = errLine.replace(/^ERROR:\s*/, '').trim()

  if (/Unsupported URL/i.test(msg)) return '不支持的链接，请确认是受支持的视频页面地址'
  if (/Video unavailable|This video is unavailable/i.test(msg)) return '视频不可用（可能已删除、设为私密或地区限制）'
  if (/Private video/i.test(msg)) return '这是私密视频，无法访问'
  if (/members-only|Premium|paid/i.test(msg)) return '该内容需要会员或付费，工具不会绕过此类限制'
  if (/Sign in to confirm|bot|not a bot/i.test(msg)) return '站点要求登录验证（反机器人），可尝试在设置中配置代理或 Cookies'
  if (/HTTP Error 403/i.test(msg)) return '服务器拒绝访问 (403)，可能是链接过期或需要 Cookies'
  if (/HTTP Error 404/i.test(msg)) return '资源不存在 (404)'
  if (/timed out|Timeout/i.test(msg)) return '网络超时，请检查网络或配置代理'
  if (/getaddrinfo|Name or service not known|nodename nor servname/i.test(msg)) return '域名解析失败，请检查网络连接'
  if (/SSL|certificate/i.test(msg)) return 'SSL 证书校验失败'
  if (/No space left/i.test(msg)) return '磁盘空间不足'
  if (/ffmpeg.*not found|ffmpeg is not installed/i.test(msg)) return '未找到 ffmpeg，请确认 resources/bin 下存在 ffmpeg.exe'
  if (/Requested format is not available/i.test(msg)) return '所选格式不可用，请重新解析后再选'
  if (/is not a valid URL/i.test(msg)) return '不是有效的链接'

  return msg.length > 200 ? msg.slice(0, 200) + '…' : msg
}

/** 删除文件，忽略不存在的情况 */
export async function removeQuiet(filePath: string): Promise<void> {
  try {
    await fsp.unlink(filePath)
  } catch {
    /* ignore */
  }
}
