# ZhihuPost 产品需求文档 (PRD)

> VSCode 插件：从 Markdown 一键发布文章到知乎（API 模式）

## 1. 项目概述

### 1.1 背景

创作者（技术博主、内容运营）在多个平台发布文章时，需要手动登录各平台、排版、填写元数据，流程重复且耗时。已有的 multipost 插件解决了微信公众号的自动发布问题，现需扩展到知乎平台。

### 1.2 目标

开发一个 VSCode 插件 **ZhihuPost**，通过知乎内部 Web API 实现从 Markdown 文件一键发布文章到知乎专栏。

### 1.3 技术路线选择

| 方案 | 体验 | 维护成本 | 选型 |
|------|------|----------|------|
| Playwright 浏览器自动化 | 慢（30-60s），需启动 Chromium | UI 选择器易失效 | 不选 |
| 知乎内部 Web API | 快（1-2s），纯 HTTP | x-zse-96 签名需跟进 | **选定** |
| 知乎 OAuth2 官方 API | 最正规 | 开放平台已停摆，无法申请 | 不可行 |

选定 API 模式的理由：
- **速度快**：发布文章仅需 1-2 秒，无需启动浏览器
- **资源占用低**：纯 HTTP 请求，零额外进程
- **可靠性高**：结构化 JSON 响应，精确错误码，不受 UI 改版影响
- **维护成本可控**：x-zse-96 签名算法与 UI 选择器维护成本相当，且已有活跃的开源实现

### 1.4 核心价值

- **效率**：将"编辑 Markdown → 登录知乎 → 手动排版 → 填写标题/话题 → 发布"的 15+ 分钟流程缩短至 **3 秒**
- **一致性**：自动将 Markdown 转换为知乎兼容的富文本 HTML
- **轻量**：无需启动浏览器，纯 HTTP 调用

## 2. 用户画像

| 角色 | 特征 | 核心需求 |
|------|------|----------|
| 技术博主 | VSCode 日常用户，Markdown 写作 | 快速发布技术文章到知乎专栏 |
| 内容运营 | 管理多个知乎专栏 | 批量发布，话题/专栏管理 |
| 知识工作者 | 非技术背景，偶尔发文 | 简单易用，零配置 |

## 3. 功能需求

### 3.1 P0 - 核心功能

| ID | 功能 | 描述 | 验收标准 |
|----|------|------|----------|
| F01 | 扫码登录 | 通过知乎二维码登录 API 获取扫码链接并轮询确认结果 | Cookie 保存到 `~/.zhihupost/cookies.json` |
| F02 | 登录态持久化 | Cookie 存储到本地，自动复用 | 下次启动时自动验证，无需重新扫码 |
| F03 | Cookie 登录 | 支持手动粘贴 Cookie 作为登录方式 | 输入 `z_c0` + `_xsrf` 即可登录 |
| F04 | Markdown 转 HTML | 将 Markdown 转换为知乎兼容的 HTML | 代码块、表格、图片、LaTeX 正确渲染 |
| F05 | 发布文章 | 调用 `POST /api/posts` 发布文章 | 返回文章 URL |
| F06 | 保存草稿 | 调用 API 保存草稿而非直接发布 | 草稿保存成功 |
| F07 | 添加话题 | 发布时指定话题 ID | 话题关联成功 |

### 3.2 P1 - 增强功能

| ID | 功能 | 描述 | 验收标准 |
|----|------|------|----------|
| F08 | 专栏收录 | 发布到指定专栏 | 专栏收录成功 |
| F09 | 封面图上传 | 通过图片上传 API 设置封面 | 封面图显示在文章卡片 |
| F10 | 内容预览 | 在 VSCode WebView 中预览排版效果 | 预览与发布后效果一致 |
| F11 | 退出登录 | 清除保存的 Cookie | 下次需重新登录 |
| F12 | 登录态检测 | 调用 `/api/v4/me` 验证 Cookie 有效性 | 过期时自动提示重新登录 |
| F13 | 文件夹批量发布 | 一次选择一个文件夹，按规则发布其中所有 Markdown 文件 | 可预检、可确认、逐篇发布并生成结果报告 |
| F14 | 批量发布失败续跑 | 批量发布中单篇失败时按配置继续或停止 | 失败文件、错误原因、已成功文章 URL 被完整记录 |
| F15 | 批量发布报告 | 批量任务结束后输出 Markdown/JSON 报告 | 报告包含总数、成功、失败、跳过、文章 URL 和错误信息 |

### 3.3 P2 - 未来功能

| ID | 功能 | 描述 |
|----|------|------|
| F16 | 发布回答 | 将内容发布为知乎回答 |
| F17 | 文章编辑 | 编辑已发布的文章 |
| F18 | 多账号切换 | 支持多个知乎账号 |
| F19 | 已发布文章去重 | 通过 frontmatter 或本地索引避免重复发布同一篇文章 |

## 4. 知乎 API 分析

### 4.1 认证机制

知乎内部 Web API 使用 Cookie 认证，核心 Cookie：

| Cookie | 说明 | 用途 |
|--------|------|------|
| `z_c0` | 授权令牌 | 生成 `Authorization: Bearer <z_c0>` 请求头 |
| `_xsrf` | CSRF Token | 生成 `x-xsrftoken` 请求头，防跨站请求 |
| `d_c0` | 设备标识 | 辅助验证 |

### 4.2 签名机制

知乎 API 请求需要 `x-zse-96` 签名头，生成逻辑：

```
输入: 请求方法 + URL 路径 + 请求体
  ↓
MD5 哈希
  ↓
自定义加密算法 (基于 zhihu_zse96 开源实现)
  ↓
Base64 编码 → "2.0_<签名>"
```

相关请求头：

| Header | 值 | 说明 |
|--------|---|------|
| `x-zse-93` | `101_3_3.0` | 客户端版本标识，固定值 |
| `x-zse-96` | `2.0_<签名>` | 请求签名，动态生成 |
| `x-xsrftoken` | `<_xsrf值>` | CSRF Token |
| `Authorization` | `Bearer <z_c0值>` | 用户认证 |

### 4.3 核心 API 端点

| 操作 | 方法 | 端点 | 说明 |
|------|------|------|------|
| 验证登录 | GET | `/api/v4/me` | 返回用户信息，验证 Cookie 有效性 |
| 发布文章 | POST | `/api/posts` | 创建文章，返回文章 ID 和 URL |
| 上传图片 | POST | `/api/v4/images` | 上传图片，返回图片 URL |
| 搜索话题 | GET | `/api/v4/search_v3?q=<关键词>&t=topic` | 搜索话题，返回话题 ID |
| 获取专栏 | GET | `/api/v4/members/<url_token>/columns` | 获取用户的专栏列表 |

### 4.4 发布文章 API 详情

```http
POST https://zhuanlan.zhihu.com/api/posts
Content-Type: application/json
Authorization: Bearer <z_c0>
x-xsrftoken: <_xsrf>
x-zse-93: 101_3_3.0
x-zse-96: 2.0_<签名>

{
  "title": "文章标题",
  "content": "<p>HTML 格式正文</p>",
  "column": "专栏slug（可选）",
  "topics": [话题ID列表（可选）],
  "draft": false,
  "commentPermission": "anyone",
  "canTip": true
}
```

成功响应：

```json
{
  "id": 12345678,
  "url": "https://zhuanlan.zhihu.com/p/12345678",
  "title": "文章标题",
  "state": "published"
}
```

### 4.5 图片上传 API 详情

```http
POST https://www.zhihu.com/api/v4/images
Content-Type: multipart/form-data
Authorization: Bearer <z_c0>
x-xsrftoken: <_xsrf>
x-zse-93: 101_3_3.0
x-zse-96: 2.0_<签名>

file: <图片二进制数据>
```

成功响应：

```json
{
  "src": "https://picx.zhimg.com/v2-xxxxx.png",
  "original_src": "https://picx.zhimg.com/v2-xxxxx_r.png"
}
```

### 4.6 内容转换规则

| Markdown 元素 | 知乎 HTML |
|---------------|-----------|
| `# 标题` | `<h2>标题</h2>` (正文从 H2 开始) |
| `**粗体**` | `<strong>粗体</strong>` |
| `*斜体*` | `<em>斜体</em>` |
| `` `代码` `` | `<code>代码</code>` |
| 代码块 | `<pre><code>...</code></pre>` |
| `[链接](url)` | `<a href="url">链接</a>` |
| `![图片](url)` | 先上传到知乎 CDN，替换为 `<img src="知乎CDN URL">` |
| `> 引用` | `<blockquote>引用</blockquote>` |
| 表格 | `<table>...</table>` |
| LaTeX | 转换为图片上传（`https://latex.codecogs.com/png.latex`） |
| Mermaid | 渲染为 PNG 后上传到知乎 CDN |

### 4.7 文件夹批量发布规则

批量发布面向“一个目录就是一个内容系列”的场景，第一版以稳定、可恢复为优先目标，不追求并发速度。

| 规则 | 说明 |
|------|------|
| 文件发现 | 默认扫描选中文件夹下的 `.md` 和 `.markdown` 文件 |
| 递归扫描 | 默认关闭；可通过配置开启，递归时跳过隐藏目录、`node_modules`、`.git` |
| 发布顺序 | 默认按文件名升序，支持按修改时间排序 |
| 标题来源 | 优先使用 Markdown 第一行 H1；没有 H1 时标记为跳过并写入报告 |
| 发布方式 | 复用单篇发布流程，逐篇串行发布，默认每篇之间保留延迟以降低频率限制风险 |
| 预检 | 正式发布前展示待发布文件列表、标题、发布方式、话题、专栏和预计数量 |
| 错误策略 | 默认单篇失败后继续处理后续文件；可配置为遇错停止 |
| 幂等策略 | 第一版不自动判断重复发布；后续通过 frontmatter 或本地索引记录 `zhihu_id` |
| 结果报告 | 批量结束后生成报告，记录成功 URL、失败原因、跳过原因和耗时 |
| 图片路径 | 每篇文章的本地图片应相对该 Markdown 文件所在目录解析 |

## 5. 非功能需求

| 维度 | 要求 |
|------|------|
| 性能 | 发布文章 < 3s（不含首次登录扫码） |
| 可靠性 | Cookie 有效期 ≥ 7 天；API 错误码精确映射 |
| 安全性 | Cookie 仅存储在本地 `~/.zhihupost/`，权限 0600 |
| 兼容性 | VSCode ≥ 1.80.0，macOS / Windows / Linux |
| 可观测性 | 所有 API 请求/响应通过 OutputChannel 输出日志 |

## 6. 配置项

| 配置 Key | 类型 | 默认值 | 说明 |
|----------|------|--------|------|
| `zhihuPublisher.defaultTopics` | `string[]` | `[]` | 默认话题关键词列表 |
| `zhihuPublisher.defaultColumn` | `string` | `""` | 默认专栏名 |
| `zhihuPublisher.publishDirectly` | `boolean` | `true` | 直接发布 vs 保存草稿 |
| `zhihuPublisher.contentThemePreset` | `string` | `"classic"` | 主题：classic/magazine/minimal |
| `zhihuPublisher.contentBodyFontSize` | `number` | `16` | 正文字号 12-22px |
| `zhihuPublisher.contentLineHeight` | `number` | `1.85` | 正文行高 1.2-2.4 |
| `zhihuPublisher.contentTextColor` | `string` | `"#1f2329"` | 正文字色 HEX |
| `zhihuPublisher.contentHeadingColor` | `string` | `"#0f172a"` | 标题字色 HEX |
| `zhihuPublisher.contentLinkColor` | `string` | `"#0969da"` | 链接/强调色 HEX |
| `zhihuPublisher.batchRecursive` | `boolean` | `false` | 文件夹批量发布是否递归扫描子目录 |
| `zhihuPublisher.batchContinueOnError` | `boolean` | `true` | 批量发布单篇失败后是否继续 |
| `zhihuPublisher.batchDelaySeconds` | `number` | `3` | 批量发布每篇文章之间的等待秒数 |
| `zhihuPublisher.batchFileOrder` | `string` | `"name-asc"` | 批量发布排序：name-asc/name-desc/mtime-asc/mtime-desc |
| `zhihuPublisher.batchDryRunDefault` | `boolean` | `true` | 批量发布默认先进入预检确认 |

## 7. 命令列表

| 命令 ID | 标题 | 描述 |
|---------|------|------|
| `zhihupost.publishToZhihu` | ZhihuPost: Publish to Zhihu | 发布当前 Markdown 到知乎 |
| `zhihupost.publishFolderToZhihu` | ZhihuPost: Publish Folder to Zhihu | 发布选中文件夹下的 Markdown 到知乎 |
| `zhihupost.loginZhihu` | ZhihuPost: Login to Zhihu | 扫码登录知乎 |
| `zhihupost.logoutZhihu` | ZhihuPost: Sign Out of Zhihu | 退出知乎登录 |
| `zhihupost.configureOptions` | ZhihuPost: Configure Publishing Options | 配置发布选项 |
| `zhihupost.preview` | ZhihuPost: Preview Zhihu Article | 预览知乎排版效果 |

## 8. 错误处理

| 错误场景 | API 响应 | 处理方式 |
|----------|----------|----------|
| 扫码超时（2分钟） | — | 提示用户重试 |
| Cookie 过期 | 401 / `x-zse-96` 校验失败 | 提示重新扫码 |
| x-zse-96 签名失效 | 10003 请求参数异常 | 提示更新插件版本 |
| 话题搜索无结果 | 空列表 | 跳过话题，继续发布 |
| 专栏未找到 | 404 | 跳过专栏，继续发布 |
| 图片上传失败 | 非 200 | 保留原始图片 URL |
| 频率限制 | 429 | 提示等待后重试 |
| 内容违规 | 10806 | 提示修改内容 |
| 批量发布未找到 Markdown | — | 提示目录中没有可发布文件 |
| 批量发布单篇缺少标题 | — | 跳过该文件并写入报告 |
| 批量发布单篇失败 | 非 2xx / API 错误 | 按 `batchContinueOnError` 继续或停止，并写入报告 |
| 批量发布触发频率限制 | 429 | 停止任务，提示冷却后从报告中的失败项继续 |
