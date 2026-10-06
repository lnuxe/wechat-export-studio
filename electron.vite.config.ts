import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * electron-vite 把主进程 / 预加载脚本 / 渲染层当作三个独立构建目标。
 * 关键约束：
 *  - main / preload 必须 external 掉 native 与 node 依赖（node: 内置模块不能被 bundle）
 *  - renderer 完全运行在 Chromium 沙箱里，任何 node 能力都必须走 preload 暴露的白名单 API
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@main': resolve('src/main')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') }
      }
    }
  },
  preload: {
    // 注意：这里不能 externalizeDepsPlugin()。
    // sandbox: true 的 preload 只能同步 require 内置模块，任何第三方包都必须打进产物，
    // 否则运行时报 "module not found: @electron-toolkit/preload"，表现为整个桥不注入。
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        external: ['electron'],
        /**
         * 沙箱化 preload 只支持 CommonJS：sandbox: true 时 Electron 用同步 require 装载它，
         * ESM 会直接报 "Cannot use import statement outside a module"。
         * 项目本身是 type: module，所以必须显式输出 .cjs 才是 CJS 语义。
         */
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') }
      }
    }
  }
})
