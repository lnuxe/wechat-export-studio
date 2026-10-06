/**
 * 生成应用图标（build/icon.ico）。
 *
 * 为什么要自己画：electron-builder 需要 .ico，而仓库里不放二进制资源更干净——
 * 图标本来就是几何图形 + 三条贝塞尔，用脚本画比塞一个 png 更容易审阅与改色。
 *
 * 输出：单个 ICO 容器，内含 16/32/48/64/128/256 六种尺寸的 PNG（Vista+ 支持 PNG 压缩条目）。
 * 画法与界面里的 KoiMarkAnimated 同源：鱼身青绿渐变、尾鳍赭色、两只纸白眼睛。
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SIZES = [16, 32, 48, 64, 128, 256]

/** 在给定尺寸下把图形点采样成 RGBA 像素 */
function renderIcon(size) {
  const pixels = Buffer.alloc(size * size * 4)

  // 归一化坐标下的覆盖判定（超采样 3x3 抗锯齿）
  const insideFishBody = (x, y) => {
    // 鱼身：一个圆角椭圆，x∈[0.06,0.94] y∈[0.24,0.82]
    const cx = 0.5
    const cy = 0.53
    const rx = 0.44
    const ry = 0.29
    const dx = (x - cx) / rx
    const dy = (y - cy) / ry
    return dx * dx + dy * dy <= 1
  }
  const insideTail = (x, y) => {
    // 尾鳍：从画布左缘展开的两片鳍，上下各一片并在中段收窄，形成分叉。
    // 关键是要比鱼身更「高/低」一点（半宽 0.30），否则尾巴会被鱼身盖住看不见。
    if (x < 0.0 || x > 0.30) return false
    const t = x / 0.30 // 0 = 尾根（最左），1 = 接身体
    const half = 0.30 - 0.10 * t
    const gap = 0.055 + 0.075 * t // 中缝：越靠身体越收窄
    const mid = 0.54 - 0.01 * t
    const d = Math.abs(y - mid)
    return d <= half && d >= gap
  }
  const insideEye = (x, y) => {
    const eye = (ex) => (x - ex) ** 2 + (y - 0.47) ** 2 <= 0.058 ** 2
    return eye(0.40) || eye(0.61)
  }
  /** 眼珠：小一号的深色点，让 32px 下也能看出「有眼睛」 */
  const insidePupil = (x, y) => {
    const pupil = (ex) => (x - (ex + 0.006)) ** 2 + (y - 0.47) ** 2 <= 0.026 ** 2
    return pupil(0.40) || pupil(0.61)
  }

  const lerp = (a, b, t) => a + (b - a) * t
  const jadeLight = [63, 143, 127]
  const jadeDeep = [31, 79, 71]
  const gold = [217, 164, 91]
  const paper = [251, 247, 239]

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      const samples = 3
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = (px + (sx + 0.5) / samples) / size
          const y = (py + (sy + 0.5) / samples) / size
          let color = null
          if (insidePupil(x, y)) {
            color = [38, 33, 28]
          } else if (insideEye(x, y)) {
            color = paper
          } else if (insideFishBody(x, y)) {
            const t = Math.min(1, Math.max(0, (x + y) / 2))
            color = [lerp(jadeLight[0], jadeDeep[0], t), lerp(jadeLight[1], jadeDeep[1], t), lerp(jadeLight[2], jadeDeep[2], t)]
          } else if (insideTail(x, y)) {
            color = gold
          }
          if (color) {
            r += color[0]
            g += color[1]
            b += color[2]
            a += 255
          }
        }
      }
      const total = samples * samples
      const index = (py * size + px) * 4
      pixels[index] = Math.round(r / total)
      pixels[index + 1] = Math.round(g / total)
      pixels[index + 2] = Math.round(b / total)
      pixels[index + 3] = Math.round(a / total)
    }
  }
  return pixels
}

/** 极简 PNG 编码器（RGBA、无滤波、非隔行） */
function encodePng(size, pixels) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0 // filter: None
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length, 0)
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0, 0)
    return Buffer.concat([length, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

let crcTable = null
function crc32(buffer) {
  if (!crcTable) {
    crcTable = new Int32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c
    }
  }
  let crc = -1
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return crc ^ -1
}

const images = SIZES.map((size) => ({ size, png: encodePng(size, renderIcon(size)) }))

// ICO 容器：6 字节头 + 每张 16 字节目录项 + 图像数据
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(images.length, 4)

let offset = 6 + images.length * 16
const entries = []
for (const image of images) {
  const entry = Buffer.alloc(16)
  entry[0] = image.size >= 256 ? 0 : image.size // 256 用 0 表示
  entry[1] = image.size >= 256 ? 0 : image.size
  entry[2] = 0 // 调色板
  entry[3] = 0 // reserved
  entry.writeUInt16LE(1, 4) // color planes
  entry.writeUInt16LE(32, 6) // bits per pixel
  entry.writeUInt32BE(0, 8)
  entry.writeUInt32LE(image.png.length, 8)
  entry.writeUInt32LE(offset, 12)
  entries.push(entry)
  offset += image.png.length
}

const outDir = join(process.cwd(), 'build')
mkdirSync(outDir, { recursive: true })
const icoPath = join(outDir, 'icon.ico')
writeFileSync(icoPath, Buffer.concat([header, ...entries, ...images.map((image) => image.png)]))
console.log(`已生成 ${icoPath}（${SIZES.join('/')} 六种尺寸，${(offset / 1024).toFixed(1)} KB）`)
