# ZhihuPost 开发日志

## 2026-05-03 — 项目初始化

### 已完成

1. **参考项目分析**：深度阅读 multipost 工程，理解其架构和实现
   - 三层架构：extension.ts (入口) → SettingsService (配置) → API service (发布编排)
   - 微信公众号发布流程：登录 → 内容管理 → 草稿箱 → 新的创作 → 文章 → 填写内容 → 发布
   - 关键技术：Cookie 持久化、Markdown 主题化、发布流程编排

2. **知乎平台研究**：调研知乎创作者中心的发文流程和技术挑战
   - 发文 URL：`https://zhuanlan.zhihu.com/write`（不是 `www.zhihu.com/creator`）
   - 参考了 zhihu-mcp、zh_mcp_server、blog-auto-publishing-tools 等开源项目

3. **项目结构创建**：在 `/Users/cygnus/work/github/zhihupost/` 下创建完整目录结构

4. **文档编写**：
   - `docs/PRD.md` — 产品需求文档
   - `docs/ARCHITECTURE.md` — 架构文档
   - `docs/DEVLOG.md` — 本文件

### 重大架构决策：从 Playwright 浏览器模式切换到 API 模式

经过深入调研，决定采用**知乎内部 Web API** 方式替代 Playwright 浏览器自动化。

**切换理由**：

| 维度 | API 模式 | 浏览器模式 |
|------|---------|-----------|
| 发布速度 | 1-2 秒 | 30-60 秒 |
| 资源占用 | ~0 | ~200MB (Chromium) |
| 内容输入 | JSON 直接传 HTML | 剪贴板粘贴 hack |
| 可靠性 | 结构化 JSON，精确错误码 | UI 选择器随时可能失效 |
| 维护点 | x-zse-96 签名算法 | UI 选择器 + Draft.js 交互 |

### 可用的开源参考项目

| 项目 | 状态 | 关键价值 |
|------|------|----------|
| **[zxc67373/zhihu-cli](https://github.com/zxc67373/zhihu-cli)** | 活跃 (2026-04-15) | 纯 HTTP 二维码登录、发布文章、Cookie 认证 |
| **[NanmiCoder/MediaCrawler](https://github.com/NanmiCoder/MediaCrawler)** | 活跃 | x-zse-96 + x-zst-81 签名实现 (`libs/zhihu.js`) |
| **[zhihulite/zhihu_zse96](https://github.com/zhihulite/zhihu_zse96)** | 2026-01-24 | 签名库：Python/Node.js/Lua/Dart (App 端 `1.0_`) |
| **[Douyh123/zhihu-mcp](https://github.com/Douyh123/zhihu-mcp)** | 2026-03-28 | Playwright 自动化参考 |

### 关键技术发现

1. **二维码登录无需 Playwright**：知乎提供 `/api/v3/account/api/login/qrcode` 接口，可纯 HTTP 实现扫码登录，整个流程无需浏览器
2. **x-zse-96 签名**：Web 端 `2.0_` 前缀签名，输入 = `x-zse-93` + `d_c0` + 方法 + URL + 请求体 → MD5 → 自定义加密 → Base64
3. **x-zst-81 参数**：部分接口还需要此参数，需额外的 SESSIONID 和 nonce 获取流程
4. **发布文章 API**：`POST https://zhuanlan.zhihu.com/api/posts`，接受 JSON body（title, content, column, topics, draft）
5. **图片上传 API**：`POST https://www.zhihu.com/api/v4/images`，multipart/form-data

### 待办（已更新为 API 模式）

- [x] 创建 package.json 和 tsconfig.json
- [x] 实现 Zse96Signer（签名生成）— 移植 zhihulite/zhihu_zse96，验证与参考实现输出一致
- [x] 实现 CookieManager（Cookie 持久化）— 文件权限 0o600，/api/v4/me 验证
- [x] 实现 ZhihuApiService（API 调用核心）— 发布文章、话题搜索、专栏获取
- [x] 实现 MarkdownRenderer — markdown-it + 三种主题（classic/magazine/minimal）
- [x] 实现纯 HTTP 二维码登录
- [x] 实现 ImageUploader
- [x] 实现 extension.ts 命令注册
- [x] 编写单元测试 — 7 个测试套件，42 个测试用例全部通过
- [x] 添加 CHANGELOG.md
- [x] 最终编译与单元测试验证
- [ ] 实际测试知乎发布流程

---

## 2026-05-04 — 文件夹批量发布规划

### 目标

新增 `ZhihuPost: Publish Folder to Zhihu` 命令，让用户选择一个文件夹后，一次性发布其中所有 Markdown 文件到知乎。该能力面向系列文章、知识库迁移和批量内容运营场景。

### 规划决策

1. **默认串行发布**：不做并发，逐篇发布并在每篇之间加入可配置延迟，降低知乎频率限制和风控风险。
2. **先预检再执行**：正式发布前列出文件数量、标题、发布方式、话题、专栏和跳过项，让用户确认后再开始。
3. **复用单篇发布链路**：批量发布只负责编排队列，实际渲染、图片上传、草稿创建、发布仍走 `ZhihuApiService.publishArticle()`。
4. **失败可恢复**：单篇失败默认继续，任务结束后生成报告，用户可以根据失败列表手动修复并重试。
5. **不自动改写原文**：第一版不向 Markdown 写入 `zhihu_id` 或 frontmatter，避免批量修改用户内容；去重和续跑索引后续再做。
6. **相对路径按文件解析**：每篇 Markdown 的本地图片路径必须相对该文件所在目录解析，不能使用工作区根目录的隐式假设。

### 架构拆解

| 模块 | 任务 | 说明 |
|------|------|------|
| `extension.ts` | 注册 `zhihupost.publishFolderToZhihu` | 支持命令面板和资源管理器文件夹右键触发 |
| `SettingsService` | 增加批量发布配置读取 | `batchRecursive`、`batchContinueOnError`、`batchDelaySeconds`、`batchFileOrder`、`batchDryRunDefault` |
| `BatchPublishService` | 新增批量发布编排服务 | 发现文件、预检、排序、队列执行、失败策略、统计结果 |
| `ZhihuApiService` | 保持单篇发布 API 作为唯一发布出口 | 必要时补充 `sourceFilePath` 或 `baseDir` 参数用于图片路径解析 |
| `BatchReportWriter` | 生成批量发布报告 | 输出 Markdown/JSON，记录成功 URL、失败原因、跳过原因和耗时 |
| `Logger` | 增加批量任务结构化日志 | 记录 batchId、filePath、articleId、status、durationMs |
| 测试 | 增加批量发布单元测试 | 文件发现、排序、预检、失败继续/停止、报告内容 |

### 开发拆解

#### Phase 5：文件夹批量发布（预计 1-2 天）

- [x] 在 `package.json` 增加 `zhihupost.publishFolderToZhihu` 命令、菜单入口和配置项
- [x] 实现 `BatchPublishService.discoverMarkdownFiles()`：支持递归、过滤目录、排序
- [x] 实现 `BatchPublishService.preflight()`：读取标题、标记跳过项、输出确认摘要
- [x] 实现串行发布队列：逐篇调用单篇发布，支持延迟和失败策略
- [x] 实现批量发布报告：记录成功、失败、跳过和文章 URL
- [x] 补充 OutputChannel 调试日志：覆盖批量任务开始、单篇开始、单篇结束、任务结束
- [x] 增加单元测试：文件发现、排序、预检、失败处理、报告生成
- [ ] 用草稿模式手工验证一个包含 2-3 篇 Markdown 的测试目录

### 风险与后续

- 知乎可能对连续发布触发 429 或风控，第一版通过串行队列和延迟降低风险。
- 如果单篇发布接口返回 HTML 错误页或 500，需要在报告中保留响应摘要，便于定位具体文章。
- 后续可增加 frontmatter 支持，例如 `zhihu_id`、`zhihu_column`、`zhihu_topics`、`publish: false`，用于去重、跳过和逐篇覆盖配置。

---

## 开发阶段规划

### Phase 1：基础框架（预计 1 天）
- package.json、tsconfig.json 配置
- SettingsService 实现
- extractTitle 工具函数
- CookieManager 实现
- extension.ts 命令注册（空壳）

### Phase 2：签名与认证（预计 1-2 天）
- Zse96Signer 签名实现（移植 zhihu_zse96/MediaCrawler 的 JS）
- 纯 HTTP 二维码登录
- Cookie 验证与刷新

### Phase 3：核心 API（预计 1-2 天）
- ZhihuApiService 发布文章
- MarkdownRenderer Markdown → HTML
- ImageUploader 图片上传
- 话题搜索与专栏获取

### Phase 4：测试与完善（预计 1 天）
- 单元测试
- 集成测试
- 预览功能
- 错误处理完善

### Phase 5：文件夹批量发布（预计 1-2 天）
- 文件夹选择和命令注册
- Markdown 文件发现、排序、预检
- 串行发布队列和失败策略
- 批量发布报告
- 批量发布单元测试和草稿模式手工验证
