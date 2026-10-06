# WeChat Export Studio · 微信聊天记录导出工作台

把 [泡菜鱼 skill](https://github.com/) 的导出流程（取密钥 → 解密 → 定位会话 → 导出 `chat.txt`）
做成一个有界面的桌面应用：**Electron 44 + React 19 + TypeScript 5.9 + Tailwind CSS 4 + Vite 7**。

仓库：<https://github.com/lnuxe/wechat-export-studio>

> ⚠️ 仅用于导出**你本人账号、你控制的机器**上的本地数据。聊天记录极敏感：
> 只在本机处理，不上传、不提交 git、不发给第三方。解密产物是明文 sqlite，请放在受控目录。
> 本仓库的 `.gitignore` 已屏蔽 `*.db` / `*.dec` / `key.txt` / `chat*.txt` / `exports/` / `decrypted/`。

---

## 为什么做这个

泡菜鱼 skill 里的 `wechat-win-export-v4` 已经把「Windows 微信 4.1+ 怎么导出」踩平了，
但命令行的痛点很明显：

- 密钥要手抄，解错了只能看出「页 1 正常、后面全乱」这种迷惑现象；
- 解密要自己拼参数，IV 偏移差 16 字节就会静默出错；
- 4MB 的过期 WAL 合并会把会话倒退好几天，**主库和 WAL 的 mtime 还完全一样**，靠时间戳判断不了；
- 导出的 `chat.txt` 有没有对（正文是不是乱码、时间对不对），得手动抽查。

这个工作台把上面每一件都做成了**可见、可验证、可回退**的操作，并且保留了「原始字节」这一层的诚实：
读不出来就标 `[无法解析]`，而不是输出一堆替换符污染语料。

---

## 它做了什么（以及每件事的依据）

| 能力 | 说明 | 依据 |
| --- | --- | --- |
| 微信环境探测 | 注册表 + 常见目录 + 盘符有界深度搜索（BFS，4 级/4 秒预算） | 实测微信 4.x 会把数据放在 `D:\Program Files\xwechat_files`，注册表 `InstallPath` 只指向程序目录 |
| 账号目录扫描 | 不假设目录名是 `wxid_` 开头，要求下面真有 `db_storage` | 实测有手机号、自定义串账号目录 |
| 密钥校验 | 只解第 1 页，看能否解出 `SQLite format 3\0` | 页尾 64 字节标签在 WCDB 上对不上标准 SQLCipher HMAC，**不做**假校验 |
| SQLCipher 解密 | `page=4096 / reserve=80 / IV@4016 / PBKDF2-HMAC-SHA512×256000` | `wechat-win-export-v4` 实测参数；页 1 密文 `[16:4016]` 必须补齐到 4096 |
| WAL 择优 | 同时跑「只用主库」「主库+全部 WAL 帧」，按 **最新消息时间 → 行数** 取新 | 实测无条件合并会把会话倒退 6 天、少 8867 行，且两文件 mtime 相同 |
| 消息解码 | `CAST(message_content AS BLOB)` + zstd 解压 + 剥 `wxid:\n` 前缀 + 类型取模归一 | 见下节「三个真实的坑」 |
| 会话画像 | 每天/每小时分布、我方占比、中位回复间隔 | 给「该怎么回」提供客观基线 |
| 导出 | `txt / md / json / csv / html`，HTML 是自包含单文件（可搜索、可打印） | txt 行格式与 `local-chat-pipeline` 完全一致 |

### 三个真实的坑（都是实测踩出来的）

1. **`message_content` 的列类型是 TEXT，但里面存的是 BLOB。**
   SQLite 的类型亲和性会把它当文本，`node:sqlite` 再按 UTF-8 解码 → 非法字节变 U+FFFD，
   **数据在到达 JS 之前就已经毁了**。修复：SQL 里写 `CAST(message_content AS BLOB)`。
   这一条修掉了 17% 的消息乱码。

2. **`local_type` 是复合值。** 例如 `21474836529` 要先取模 `2^32` 再取模 `10000` 才是基础类型（1=文本）。
   只按原值查表会把图片/链接统统判成 unknown。

3. **服务实例必须跟着配置重建。** 早期版本在模块 `import` 阶段就构造了 `ChatStore`，
   之后给 workspace 设上数据目录并不会重建它 —— 结果「谁是我」永远推不出来，
   全部消息被判成对方发的（统计显示 `我 0 / 对方 4720`）。
   修复：按配置版本号懒重建（`currentServices()`）。

---

## 界面

```
┌──────────────────────────────────────────────────────────────┐
│ 泡菜鱼 · 导出工作台   ● 微信已连接 · 4.1.15.13   ⏸实时   ⚙   │  标题栏：只放连接状态与设置
├────┬──────────────┬──────────────────────────────────────────┤
│连接│  会话列表     │  张 文 亭        4760 条 · 数据更新于…    │  三栏：图标导航 / 会话 / 对话
│会话│  搜索框       │  ┌────────────────────────────────┐      │
│导出│  · 张文亭     │  │  消息气泡（贴底、往上滚加载更早）│      │
│    │  · 深圳工会   │  └────────────────────────────────┘      │
│    │  · …         │  ↓ 200 条新消息                          │
└────┴──────────────┴──────────────────────────────────────────┘
                          ▼ 导出抽屉（默认收起，右侧滑出）
```

三条设计决定：

1. **没有路径**。所有绝对路径、数据库表名、置信度、运行时版本都收进「设置」抽屉，
   主界面只呈现用户要读的东西。
2. **对话优先**。默认落在「会话」页，消息贴底显示，往上滚自动加载更早的内容，
   来新消息时若已在底部就自动跟随（带「回到最新」兜底）。
3. **导出是抽屉，不是页面**。低频操作不值得常驻，但预检（条数 + 预计体积）必须在点导出前可见。

### 「实时」到底是什么

标题栏与会话头部的「实时」是**对已解密数据库的 1.5 秒短轮询**，不是微信推送：

- 水位线取已加载消息的最大时间戳，只拉比它更新的行；
- 窗口失焦自动暂停，避免无意义 IO；
- 因此它只能反映「最后一次解密」那一刻的库状态——界面上用一行小字明确写出来了。

要做到真正的实时，需要在微信写入时同步解密（WAL 增量解密），那是另一个量级的工程。

### 美术资源

全部内联 SVG + CSS 动画，没有外部图片、没有动画库：

- `art/animated.tsx`：会游的墨鱼（换会话/解密进度）、互相靠近的对话气泡（空状态）、
  流动的墨线（加载中）、印章、迷你柱状图；
- `art/artwork.tsx`：纸纹底、鱼鳞暗纹；
- `art/icons.tsx`：30 个手绘风格图标（统一 24 格网格、圆角端点）。
- 所有动效都尊重 `prefers-reduced-motion`：关掉动画仍是一张完整插画。
- 皮肤：暖纸 / 冷墨 / 跟随系统，令牌层切换，动效与插画随之变色（用 CSS 变量着色）。

---

```
src/
├─ shared/                     # 三端共享的单一事实来源
│  ├─ ipc.ts                   #   通道名 + 事件名 + IpcResult 信封
│  ├─ contracts.ts             #   函数名 → [入参, 返回] 的契约表
│  └─ types.ts                 #   全域领域模型
├─ main/                       # 主进程：唯一持有系统能力的地方
│  ├─ core/                    #   errors / logger / workspace / registry / env
│  ├─ services/                #   领域服务（无 Electron 依赖，可单测）
│  │  ├─ wechat-environment.ts #     环境与账号探测（含盘符 BFS）
│  │  ├─ key-service.ts        #     密钥读取与页 1 校验
│  │  ├─ sqlcipher.ts          #     解密、WAL 解析、双策略择优、结构自检
│  │  ├─ sqlite-reader.ts      #     只读 sqlite（node:sqlite，python 兜底）
│  │  ├─ message-codec.ts      #     字节 → 领域消息（zstd/前缀/类型）
│  │  ├─ chat-store.ts         #     会话列表、定位、消息、统计
│  │  └─ export-runner.ts      #     预检 → 渲染 → 落盘 → 历史
│  ├─ ipc/index.ts             #   IPC 边界：唯一的出入口，异常收敛成信封
│  ├─ smoke.ts                 #   `--wes-smoke`：真数据全链路自检
│  ├─ ui-check.ts              #   `--wes-ui-check`：开窗、切页、抓图
│  └─ ui-flow.ts               #   `--wes-ui-flow`：真数据驱动界面走完导出
├─ preload/index.ts            # contextBridge 白名单桥（CJS，sandbox 可用）
└─ renderer/src/
   ├─ components/art/          #   动效插画 / 底纹 / 30 个手绘图标
   ├─ components/chat/         #   会话列表 / 消息气泡 / 导出抽屉
   ├─ components/ui/           #   基础组件（Button/Card/Badge/Field…）
   ├─ components/layout/       #   标题栏 / 图标导航 / 设置抽屉 / 提示
   ├─ hooks/useLiveSync.ts     #   对话窗的短轮询同步（含失焦暂停）
   ├─ pages/                   #   连接 / 会话 / 导出
   ├─ store/studio.ts          #   zustand：单一状态源 + 动作
   ├─ api/                     #   IPC 的类型安全薄封装
   └─ styles/theme.css         #   设计令牌（@theme）+ 纸感/夜间两套皮肤
```

### 安全边界

- `contextIsolation: true` + `nodeIntegration: false` + `sandbox: true`；
- 渲染层只能调用 `IpcContract` 里声明过的通道，通道名写错**编译期**就报错；
- 外链一律交给系统浏览器，应用内导航被拦截，权限请求一律拒绝；
- CSP 不含 `unsafe-eval`，不加载任何远程资源；
- 渲染层拿不到 `fs`/`child_process`/绝对路径以外的任何能力。

---

## 快速开始

```bash
npm install          # 若 electron 二进制下载失败：ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm run dev          # 开发模式（HMR）
npm run build        # 类型检查 + 三端构建
npm start            # 预览构建产物
```

### 打包 Windows 安装包

```bash
node scripts/make-icon.mjs    # 生成 build/icon.ico（六种尺寸，脚本绘制）
npm run dist:win              # 产物写入 release/
```

国内网络建议同时设置镜像，否则 electron-builder 下载 NSIS 组件会很慢：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
```

已发布的安装包见 [Releases](https://github.com/lnuxe/wechat-export-studio/releases)（v0.1.0 约 106 MB）。
打包产物本身不进仓库：`.gitignore` 已屏蔽 `release/`，安装包只作为 Release 资产发布。

> 网络提示：部分网络环境下 `github.com:443` 不通（而 `api.github.com` 通），
> 表现为 `npm install`/`git push` 超时。给 git 临时挂代理即可，不必改全局配置：
> `git -c http.proxy=http://127.0.0.1:7897 push`

### 使用顺序

1. **连接**：确认账号已识别 → 密钥验证通过 → 点「开始解密」。
   解密时每个库都会打印 `main-only` / `wal-merged` 的 `newest` 与 `rows`，
   **请把 newest 和微信窗口里最新一条消息对一下**——这是一致性的唯一硬证据。
2. **会话**：左侧搜索选人，中间读消息（往上滚加载更早的内容，右上角可开「实时」）。
   点右上「导出」滑出抽屉，勾格式 → 看预检 → 开始导出。
3. **导出**：点文件名用系统程序打开；`chat.txt` 可直接喂给泡菜鱼做分析。

### 自检命令（本仓库的开发验收手段）

```bash
npm run smoke           # 真实微信库跑完 解密→会话→导出 全链路，33 项断言
npm run smoke:ui        # 开窗、逐页切换、抓图、收集渲染错误
npm run smoke:flow      # 用 smoke 的解密产物驱动界面：滚动加载→导出→设置→换肤，16 项
npm run check:encoding  # 源码里不该有 BOM / 替换符 / NUL 字节
```

自检用**独立的 userData 与 `%TEMP%` 工作区**，跑完不会改动你自己的配置
（早期版本会覆盖 `userData/config.json`，已修）。

最近一次验证（真实账号 17 库 / 417 MB）：

| 项目 | 结果 |
| --- | --- |
| `smoke` 全链路 | **33/33 通过**（解密 17/17 库 · WAL 防护命中 · 5 种格式导出 · 正文零乱码） |
| `smoke:flow` 界面验收 | **16/16 通过**（含滚动加载、回到最新贴底 0px、换肤生效） |
| `smoke:ui` 基础自检 | 渲染 / preload 桥 / 路由全 PASS，零渲染错误 |
| 打包版（`release/win-unpacked`） | 17 项通过：真密钥真库解密成功 |

---

## 与上游的关系

- 导出流程与「五个坑」的判定逻辑来自泡菜鱼 skill 的 `wechat-win-export-v4`；
  本应用把它的 python 脚本用 TypeScript 重写，并补上了 `CAST(... AS BLOB)` 这一层修复。
- 取密钥仍然依赖 [Ray0612/WeChat-Export-Tool](https://github.com/Ray0612/WeChat-Export-Tool)
  的 `wx_key.dll`（微信 4.x 内存里只有 passphrase，`SetDBKey` 只在进程启动时调用一次），
  本应用负责找到并验证它的产物 `key.txt`。
- 界面参考了 [Panther114/Weport](https://github.com/Panther114/Weport) 等 Electron 方案的思路，
  但没有复用其代码：这里的 3 个页面、两个抽屉、图标集与动效插画都是为本工作台原创的。

## 许可

MIT（本应用代码）。上游 skill 与第三方工具的许可各自从其仓库。
详见 [LICENSE](LICENSE)。
