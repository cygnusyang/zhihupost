# ZhihuPost 架构文档

## 1. 系统架构

### 1.1 架构总览

ZhihuPost 采用 API 驱动架构，通过知乎内部 Web API 完成发布、图片上传、登录态校验和二维码登录：

```mermaid
graph TB
    subgraph VSCode_Extension["VSCode Extension"]
        Commands["Commands<br/>(extension.ts)"]
        Settings["Settings<br/>Service"]
        WebView["WebView<br/>Preview"]
        
        subgraph ZhihuApiService["ZhihuApiService"]
            Auth["Auth<br/>Manager"]
            Request["Request<br/>Client"]
            Zse96Signer["Zse96Signer<br/>(签名生成)"]
        end

        subgraph ScheduledPublishing["Scheduled Publishing"]
            ScheduledTaskService["ScheduledTaskService"]
            TaskStorage["TaskStorage<br/>~/.zhihupost/scheduled-tasks.json"]
            PlatformScheduler["PlatformScheduler<br/>cron / Task Scheduler"]
        end
        
        subgraph MarkdownRenderer["MarkdownRenderer"]
            MD2HTML["Markdown<br/>→ HTML"]
            ImageUploader["Image<br/>Uploader"]
            LatexMermaid["LaTeX/Mermaid<br/>Processor"]
        end
    end

    subgraph BackgroundRuntime["Background Runtime"]
        CLI["zhihupost-publish CLI"]
        CLIPublisher["CLIPublisher"]
    end
    
    Commands --> ZhihuApiService
    Commands --> ScheduledTaskService
    ScheduledTaskService --> TaskStorage
    ScheduledTaskService --> PlatformScheduler
    PlatformScheduler -->|"到点执行"| CLI
    CLI --> CLIPublisher
    CLIPublisher --> TaskStorage
    CLIPublisher --> ZhihuApiService
    Settings --> ZhihuApiService
    WebView --> MarkdownRenderer
    ZhihuApiService --> MarkdownRenderer
    
    VSCode_Extension -->|"HTTP API<br/>zhuanlan.zhihu.com<br/>www.zhihu.com"| External["知乎 API"]
    
    style VSCode_Extension fill:#e1f5ff,stroke:#01579b
    style ZhihuApiService fill:#fff9c4,stroke:#f57f17
    style MarkdownRenderer fill:#e8f5e9,stroke:#2e7d32
    style External fill:#ffecb3,stroke:#ff6f00
```

### 1.2 核心组件

| 组件 | 文件 | 职责 |
|------|------|------|
| **Extension Entry** | `src/extension.ts` | 插件激活/停用、命令注册、编排服务调用 |
| **ZhihuApiService** | `src/services/ZhihuApiService.ts` | API 调用核心：认证、发布、图片上传 |
| **QrLoginService** | `src/services/QrLoginService.ts` | 纯 HTTP 二维码登录 |
| **Zse96Signer** | `src/services/Zse96Signer.ts` | 生成 `x-zse-96` 签名 |
| **CookieManager** | `src/services/CookieManager.ts` | Cookie 持久化与验证 |
| **SettingsService** | `src/services/SettingsService.ts` | 读写 VSCode 配置项 |
| **BatchPublishService** | `src/services/BatchPublishService.ts` | 文件夹批量发布编排：发现文件、预检、队列执行、报告生成 |
| **ScheduledTaskService** | `src/services/ScheduledTaskService.ts` | 定时发布编排：创建任务、更新/删除任务、错过任务检测、失败重试 |
| **TaskStorage** | `src/services/TaskStorage.ts` | 定时任务本地存储：`~/.zhihupost/scheduled-tasks.json` 与执行报告目录 |
| **PlatformScheduler** | `src/services/PlatformScheduler.ts` | 平台调度抽象：macOS/Linux 使用 cron，Windows 使用 Task Scheduler |
| **CronManager** | `src/services/CronManager.ts` | 安装、删除、列出 ZhihuPost cron 条目 |
| **WindowsTaskScheduler** | `src/services/WindowsTaskScheduler.ts` | 通过 `schtasks.exe` 安装、删除、列出 Windows 一次性任务 |
| **CLIPublisher** | `src/cli/CLIPublisher.ts` | 被系统调度器唤起后的后台发布执行器 |
| **MarkdownRenderer** | `src/utils/MarkdownRenderer.ts` | Markdown → 知乎兼容 HTML |
| **ImageUploader** | `src/utils/ImageUploader.ts` | 图片上传到知乎 CDN |
| **extractTitle** | `src/utils/extractTitle.ts` | 从 Markdown 提取标题 |

## 2. 数据流

### 2.1 发布文章数据流

```mermaid
graph TD
    MD["Markdown 文件"]
    Title["extractTitle()"]
    TitleResult["标题"]
    Renderer["MarkdownRenderer.render()"]
    HTML["知乎兼容 HTML"]
    Uploader["ImageUploader.upload()"]
    Replace["替换图片 URL 为知乎 CDN"]
    Publish["ZhihuApiService.publishArticle()"]
    LoadCookie["1. CookieManager.load()<br/>加载 Cookie"]
    Validate["2. CookieManager.validate()<br/>调用 /api/v4/me 验证"]
    Sign["3. Zse96Signer.sign()<br/>生成请求签名"]
    Post["4. POST /api/posts<br/>发布文章"]
    ReturnURL["5. 返回文章 URL"]
    ArticleURL["文章 URL"]
    
    MD --> Title
    Title --> TitleResult
    TitleResult --> Renderer
    Renderer --> HTML
    HTML --> Uploader
    Uploader --> Replace
    Replace --> Publish
    Publish --> LoadCookie
    LoadCookie --> Validate
    Validate --> Sign
    Sign --> Post
    Post --> ReturnURL
    ReturnURL --> ArticleURL
    
    style MD fill:#e3f2fd,stroke:#1565c0
    style ArticleURL fill:#c8e6c9,stroke:#2e7d32
    style Publish fill:#fff9c4,stroke:#f57f17
```

### 2.2 登录流程

```mermaid
graph TD
    subgraph FirstLogin["首次登录（纯 HTTP 二维码）"]
        QRCode["POST /api/v3/account/api/login/qrcode"]
        TokenLink["获取 token/link"]
        Scan["用户用知乎 App 扫码确认"]
        Poll["轮询 scan_info"]
        Save["保存到 ~/.zhihupost/cookies.json"]
        
        QRCode --> TokenLink
        TokenLink --> Scan
        Scan --> Poll
        Poll --> Save
    end
    
    subgraph SubsequentUse["后续使用（纯 HTTP）"]
        Load["CookieManager.load()"]
        Validate["CookieManager.validate()"]
        Valid["有效则继续"]
        Invalid["无效则提示重新扫码"]
        
        Load --> Validate
        Validate --> Valid
        Validate --> Invalid
    end
    
    subgraph ManualLogin["手动 Cookie 登录"]
        Copy["用户从浏览器 DevTools 复制 Cookie"]
        SaveCookie["CookieManager.save(cookieString)"]
        Use["直接使用，无需扫码"]
        
        Copy --> SaveCookie
        SaveCookie --> Use
    end
    
    Save --> Load
    
    style FirstLogin fill:#e1f5fe,stroke:#0277bd
    style SubsequentUse fill:#fff3e0,stroke:#ef6c00
    style ManualLogin fill:#f3e5f5,stroke:#7b1fa2
```

### 2.3 图片上传流程

```mermaid
graph TD
    Images["Markdown 中的本地/远程图片"]
    Local["本地图片: 直接读取文件"]
    Remote["远程图片: 下载到临时目录"]
    Sign["Zse96Signer.sign<br/>(POST, /api/v4/images)"]
    Post["POST /api/v4/images<br/>(multipart/form-data)"]
    CDN["知乎 CDN URL"]
    Replace["替换 HTML 中的 img src"]
    
    Images --> Local
    Images --> Remote
    Local --> Sign
    Remote --> Sign
    Sign --> Post
    Post --> CDN
    CDN --> Replace
    
    style Images fill:#e3f2fd,stroke:#1565c0
    style CDN fill:#c8e6c9,stroke:#2e7d32
    style Replace fill:#fff9c4,stroke:#f57f17
```

### 2.4 文件夹批量发布流程

```mermaid
graph TD
    UserSelect["用户选择文件夹 / 右键文件夹命令"]
    Discover["BatchPublishService.discoverMarkdownFiles()"]
    Filter1["过滤隐藏目录、node_modules、.git"]
    Match["匹配 .md / .markdown"]
    Sort["按配置排序"]
    Preflight["BatchPublishService.preflight()"]
    ReadMD["读取每个 Markdown"]
    ExtractTitle["extractTitle() 提取标题"]
    MarkSkip["标记缺少标题/空文件等跳过项"]
    ShowSummary["展示预检摘要并等待用户确认"]
    PublishQueue["BatchPublishService.publishQueue()"]
    PublishOne["逐篇调用单篇发布流程"]
    Delay["每篇之间按配置延迟"]
    HandleError["单篇失败按配置继续或停止"]
    Log["实时写入 OutputChannel 日志"]
    WriteReport["BatchReportWriter.write()"]
    Report["生成成功/失败/跳过报告"]
    
    UserSelect --> Discover
    Discover --> Filter1
    Filter1 --> Match
    Match --> Sort
    Sort --> Preflight
    Preflight --> ReadMD
    ReadMD --> ExtractTitle
    ExtractTitle --> MarkSkip
    MarkSkip --> ShowSummary
    ShowSummary --> PublishQueue
    PublishQueue --> PublishOne
    PublishOne --> Delay
    Delay --> HandleError
    HandleError --> Log
    Log --> WriteReport
    WriteReport --> Report
    
    style UserSelect fill:#e3f2fd,stroke:#1565c0
    style Report fill:#c8e6c9,stroke:#2e7d32
    style PublishQueue fill:#fff9c4,stroke:#f57f17
```

批量发布默认串行执行，不做并发发布。原因是知乎发布接口存在频率限制和风控，串行队列更容易定位失败项，也便于后续从报告续跑。

### 2.5 定时发布流程

```mermaid
graph TD
    Command["ZhihuPost: Schedule Publish"]
    ActiveEditor["读取当前 Markdown 文件"]
    InputTime["输入本地时间<br/>YYYY-MM-DD HH:MM"]
    PickMode["选择直接发布 / 保存草稿"]
    ValidateFile["ScheduledTaskService.validateFile()<br/>检查文件存在和 H1 标题"]
    ValidateLogin["ZhihuApiService.isLoggedIn()<br/>确认已有知乎登录态"]
    CreateTask["创建 ScheduledTask<br/>UUID + 文件路径 + 发布时间 + 发布选项"]
    SaveTask["TaskStorage.saveTask()<br/>写入 ~/.zhihupost/scheduled-tasks.json"]
    InstallScheduler["PlatformScheduler.installScheduledTask()"]
    Cron["macOS/Linux: cron<br/>node cli/index.js --task-id"]
    WinTask["Windows: schtasks /create /sc once"]
    Trigger["系统调度器到点唤起 CLI"]
    CLILoad["CLIPublisher.executeTask()<br/>按 taskId 读取任务"]
    MarkRunning["标记 running"]
    ReadFile["读取 Markdown 并提取标题"]
    Publish["复用 ZhihuApiService.publishArticle()<br/>sourceBaseDir = Markdown 所在目录"]
    MarkDone["成功: completed + result"]
    MarkFailed["失败: failed + error"]
    Report["写入 scheduled-tasks-reports/task-*.md"]
    DeleteTask["按 deleteOnSuccess 删除任务"]

    Command --> ActiveEditor
    ActiveEditor --> InputTime
    InputTime --> PickMode
    PickMode --> ValidateFile
    ValidateFile --> ValidateLogin
    ValidateLogin --> CreateTask
    CreateTask --> SaveTask
    SaveTask --> InstallScheduler
    InstallScheduler --> Cron
    InstallScheduler --> WinTask
    Cron --> Trigger
    WinTask --> Trigger
    Trigger --> CLILoad
    CLILoad --> MarkRunning
    MarkRunning --> ReadFile
    ReadFile --> Publish
    Publish --> MarkDone
    Publish --> MarkFailed
    MarkDone --> Report
    MarkFailed --> Report
    Report --> DeleteTask

    style Command fill:#e3f2fd,stroke:#1565c0
    style InstallScheduler fill:#fff9c4,stroke:#f57f17
    style Publish fill:#fff9c4,stroke:#f57f17
    style Report fill:#c8e6c9,stroke:#2e7d32
```

定时发布不依赖 VSCode 进程常驻。VSCode 只负责创建任务、保存任务元数据，并把一次性执行命令注册到操作系统调度器；真正到点发布时，由系统调度器启动 Node CLI，再由 CLI 读取同一份任务存储并复用 `ZhihuApiService.publishArticle()` 完成发布。

实现细节：

- 用户入口是 `zhihupost.schedulePublish`，命令面板标题为 `ZhihuPost: Schedule Publish`。它要求当前活动编辑器是 Markdown 文件，发布时间按本地时间输入，随后选择直接发布或保存草稿。
- `ScheduledTaskService.scheduleTask()` 会先校验文件存在、文章有 H1 标题、知乎登录态有效，然后生成 UUID 任务，保存 `filePath`、`originalScheduledTime`、`scheduledTime`、发布选项、重试次数和成功后是否删除等字段。
- `TaskStorage` 默认使用 `~/.zhihupost/scheduled-tasks.json` 存储任务列表，执行报告写入 `~/.zhihupost/scheduled-tasks-reports/`。这让 VSCode 命令、系统调度器和后台 CLI 可以共享同一份状态。
- `AutoPlatformScheduler` 根据 `os.platform()` 选择调度后端：Windows 使用 `WindowsTaskScheduler`，其他平台使用 `CronManager`。
- macOS/Linux 上，`CronManager` 把 ISO 时间转换成 cron 的本地时间表达式，并追加两行 crontab：`# ZhihuPost task <id>` 注释和 `node <cliPath> --task-id <id> >> ~/.zhihupost/scheduled-tasks-reports/cron.log 2>&1` 执行命令。
- Windows 上，`WindowsTaskScheduler` 通过 `schtasks /create /sc once /st <HH:mm> /sd <MM/dd/yyyy>` 创建一次性任务，任务名为 `ZhihuPost-<id>`，执行命令同样是 Node CLI 加 `--task-id <id>`。
- CLI 入口是 `src/cli/index.ts`，命令名为 `zhihupost-publish`。它初始化 `TaskStorage` 和 `ZhihuApiService`，然后调用 `CLIPublisher.executeTask(taskId)`。
- `CLIPublisher` 执行时会把任务标记为 `running`，重新读取 Markdown、提取标题、检查登录态，再调用 `ZhihuApiService.publishArticle()`。这里传入 `sourceBaseDir: path.dirname(task.filePath)`，确保定时任务里的相对图片路径仍按原 Markdown 文件所在目录解析。
- 发布成功后任务状态写为 `completed`，记录文章 ID、URL、耗时并生成报告；如果 `deleteOnSuccess` 为 `true`，任务会从 `scheduled-tasks.json` 删除。失败时任务状态写为 `failed`，报告中记录错误信息，用户可以从任务列表里触发重试。
- VSCode 插件激活时会调用 `detectAndHandleMissedTasks()`：如果有 `pending` 任务的计划时间已过，单个错过任务会改到当前时间立即重新安装调度；多个错过任务会按原始计划时间的相对间隔整体平移，避免恢复后同时发布多篇。

## 3. 核心组件详细设计

### 3.1 ZhihuApiService

```typescript
class ZhihuApiService {
  private cookieManager: CookieManager;
  private signer: Zse96Signer;
  private imageUploader: ImageUploader;

  // ── 认证 ──
  async initiateQrLogin(): Promise<{ token: string; link: string }>;
  async pollQrLogin(token: string): Promise<QrLoginResult>;
  async loginViaCookie(cookie: string): Promise<void>;  // 手动粘贴
  async logout(): Promise<void>;
  async isLoggedIn(): Promise<boolean>;       // 调用 /api/v4/me

  // ── 发布 ──
  async publishArticle(params: PublishArticleParams): Promise<PublishResult>;
  async saveDraft(params: PublishArticleParams): Promise<PublishResult>;

  // ── 图片 ──
  async uploadImage(filePath: string): Promise<string>;  // 返回 CDN URL

  // ── 话题/专栏 ──
  async searchTopics(keyword: string): Promise<Topic[]>;
  async getColumns(): Promise<Column[]>;

  // ── 内部 ──
  private async request(method: string, path: string, body?: unknown): Promise<unknown>;
}
```

### 3.2 Zse96Signer

```typescript
class Zse96Signer {
  // 生成 x-zse-96 签名
  sign(method: string, path: string, body?: string): string;

  // 生成完整请求头
  buildHeaders(method: string, path: string, body?: string): Record<string, string>;
  // 返回: {
  //   Authorization: 'Bearer <z_c0>',
  //   'x-xsrftoken': '<_xsrf>',
  //   'x-zse-93': '101_3_3.0',
  //   'x-zse-96': '2.0_<签名>',
  //   'Content-Type': 'application/json',
  // }
}
```

### 3.3 CookieManager

```typescript
interface ZhihuCookies {
  z_c0: string;       // 授权令牌
  _xsrf: string;      // CSRF Token
  d_c0: string;       // 设备标识
  [key: string]: string;
}

class CookieManager {
  private cookiePath: string;  // ~/.zhihupost/cookies.json

  async load(): Promise<ZhihuCookies | null>;
  async save(cookies: ZhihuCookies): Promise<void>;
  async validate(): Promise<boolean>;  // GET /api/v4/me
  async clear(): Promise<void>;
  parseCookieString(cookieString: string): ZhihuCookies;
}
```

### 3.4 PublishArticleParams & PublishResult

```typescript
interface PublishArticleParams {
  title: string;
  content: string;        // HTML 格式
  topics?: string[];      // 话题关键词
  column?: string;        // 专栏 slug
  coverImage?: string;    // 封面图本地路径
  publishDirectly: boolean;
  contentStyle: ContentStyleSettings;
  sourceBaseDir?: string;  // Markdown 所在目录，用于解析相对图片路径
}

interface PublishResult {
  success: boolean;
  articleId?: number;
  articleUrl?: string;
  error?: string;
  errorCode?: number;
}
```

### 3.5 MarkdownRenderer

```typescript
class MarkdownRenderer {
  private markdownParser: MarkdownIt;

  render(markdown: string, style: ContentStyleSettings): string;
  private stripLeadingTopLevelHeading(markdown: string): string;
  private processLatex(content: string): string;
  private applyThemedStyles(html: string, style: ContentStyleSettings): string;
  private compactHtml(content: string): string;
}
```

### 3.6 BatchPublishService

```typescript
interface BatchPublishOptions {
  folderUri: vscode.Uri;
  recursive: boolean;
  dryRun: boolean;
  continueOnError: boolean;
  publishDirectly: boolean;
  defaultTopics: string[];
  defaultColumn?: string;
  fileOrder: 'name-asc' | 'name-desc' | 'mtime-asc' | 'mtime-desc';
  delaySeconds: number;
}

interface BatchPublishItem {
  filePath: string;
  title?: string;
  status: 'pending' | 'skipped' | 'publishing' | 'success' | 'failed';
  articleId?: number | string;
  articleUrl?: string;
  error?: string;
}

interface BatchPublishResult {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  items: BatchPublishItem[];
  reportPath?: string;
}

class BatchPublishService {
  constructor(
    private zhihuApiService: ZhihuApiService,
    private settingsService: SettingsService,
  ) {}

  async publishFolder(options: BatchPublishOptions): Promise<BatchPublishResult>;
  async discoverMarkdownFiles(folderUri: vscode.Uri, recursive: boolean): Promise<vscode.Uri[]>;
  async preflight(files: vscode.Uri[]): Promise<BatchPublishItem[]>;
  private async publishOne(item: BatchPublishItem, options: BatchPublishOptions): Promise<BatchPublishItem>;
  private async writeReport(result: BatchPublishResult): Promise<string>;
}
```

实现约束：

- 批量发布必须复用 `ZhihuApiService.publishArticle()`，避免维护两套发布逻辑。
- 每篇文章渲染和图片上传时，工作目录应切换到该 Markdown 文件所在目录，确保相对图片路径正确。
- 每篇文章发布前后都要输出结构化日志：文件路径、标题、文章 ID、URL、错误码、耗时。
- 第一版不自动写回 Markdown frontmatter，避免意外改动用户文章；去重和续跑索引作为后续能力设计。

### 3.7 Scheduled Publishing

```typescript
interface ScheduledTask {
  id: string;
  filePath: string;
  originalScheduledTime: string;
  scheduledTime: string;
  createdAt: string;
  lastExecutedAt: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  attemptCount: number;
  maxRetries: number;
  deleteOnSuccess: boolean;
  publishOptions: {
    topics?: string[];
    column?: string;
    publishDirectly: boolean;
    contentStyle: ContentStyleSettings;
  };
  result?: {
    executedAt: string;
    success: boolean;
    articleId?: number;
    articleUrl?: string;
    error?: string;
    errorCode?: number;
    durationMs: number;
  };
}

class ScheduledTaskService {
  async scheduleTask(options: ScheduledTaskCreateOptions): Promise<ScheduledTask>;
  async getAllTasks(): Promise<ScheduledTask[]>;
  async getTask(taskId: string): Promise<ScheduledTask | null>;
  async updateTask(task: ScheduledTask): Promise<void>;
  async deleteTask(taskId: string): Promise<void>;
  async detectAndHandleMissedTasks(): Promise<ScheduledTask[]>;
  async retryFailedTask(taskId: string): Promise<ScheduledTask>;
}

interface PlatformScheduler {
  installScheduledTask(task: ScheduledTask): Promise<void>;
  removeScheduledTask(taskId: string): Promise<void>;
  listScheduledTasks(): Promise<Array<{ taskId: string; info: string }>>;
}
```

实现约束：

- 定时发布必须通过操作系统调度器唤起 CLI，不能依赖 VSCode 窗口一直打开。
- 调度器只保存“到点执行哪个 taskId”的命令，发布参数和状态以 `TaskStorage` 为准。
- 创建任务时要先保存本地任务，再安装系统调度；如果安装失败，必须回滚删除本地任务，避免出现不会被执行的悬挂任务。
- 编辑任务时先移除旧系统调度，再更新本地任务并安装新调度。
- 删除任务时同时删除系统调度和本地任务。
- CLI 执行路径必须复用单篇发布链路，避免定时发布和手动发布产生不同渲染、图片上传或 API 行为。
- 失败任务由用户手动重试；重试使用指数退避重新安排，当前实现为第 1/2/3 次重试分别约 2/4/8 分钟后执行。

## 4. API 模式 vs 浏览器模式对比

| 维度 | API 模式 (选定) | 浏览器模式 (不选) |
|------|----------------|-----------------|
| 发布速度 | 1-2 秒 | 30-60 秒 |
| 资源占用 | ~0（纯 HTTP） | ~200MB（Chromium） |
| 内容输入 | JSON 直接传 HTML | 剪贴板粘贴 hack |
| 可靠性 | 结构化 JSON，精确错误码 | UI 选择器随时可能失效 |
| 维护点 | x-zse-96 签名算法 | UI 选择器 + Draft.js 交互 |
| 登录 | 纯 HTTP 二维码 / Cookie 粘贴 | Playwright 保持会话 |
| 风控 | 需控制频率 | 模拟真人，风险较低 |
| 依赖 | node-fetch | playwright(全程) |

## 5. x-zse-96 签名实现

### 5.1 签名算法

```mermaid
graph TD
    Input["签名输入 = f'101_3_3.0' + '+' + d_c0 + '+' + 方法 + '+' + URL路径 + '+' + 请求体"]
    MD5["MD5 哈希 (小写)"]
    Encrypt["自定义加密<br/>(基于 zhihu_zse96 的 encrypt 函数)"]
    Output["'2.0_' + Base64(加密结果)"]
    
    Input --> MD5
    MD5 --> Encrypt
    Encrypt --> Output
    
    style Input fill:#e3f2fd,stroke:#1565c0
    style Output fill:#c8e6c9,stroke:#2e7d32
    style Encrypt fill:#fff9c4,stroke:#f57f17
```

### 5.2 实现策略

移植 [zhihu_zse96](https://github.com/zhihulite/zhihu_zse96) 的 Node.js 实现到 TypeScript：

1. 提取核心 `encrypt` 函数
2. 封装为 `Zse96Signer` 类
3. 输入：HTTP 方法 + URL 路径 + 请求体 + d_c0 Cookie
4. 输出：完整的 `x-zse-96` 签名值

### 5.3 版本更新应对

- `x-zse-93` 版本号变化时需更新常量
- 加密算法变化时需重新逆向，更新 `Zse96Signer`
- 插件版本检查机制：签名失效时提示用户更新

## 6. 错误恢复

| 场景 | 检测方式 | 恢复策略 |
|------|----------|----------|
| Cookie 过期 | `/api/v4/me` 返回 401 | 提示重新扫码或粘贴 Cookie |
| 签名失效 | 10003 错误码 | 提示更新插件版本 |
| 网络超时 | fetch 超时 | 重试 1 次，间隔 2 秒 |
| 频率限制 | 429 状态码 | 提示等待，显示冷却时间 |
| 内容违规 | 10806 错误码 | 提示修改内容后重试 |
| 图片上传失败 | 非 200 响应 | 保留原始 URL，继续发布 |
| 话题搜索无结果 | 空列表 | 跳过话题，继续发布 |
| 专栏未找到 | 404 | 跳过专栏，继续发布 |

## 7. 文件结构

```mermaid
graph TD
    Root["zhihupost/"]
    
    subgraph src["src/"]
        extension["extension.ts<br/>插件入口，命令注册"]
        
        subgraph services["services/"]
            ZhihuApi["ZhihuApiService.ts<br/>API 调用核心"]
            BatchPublish["BatchPublishService.ts<br/>文件夹批量发布编排"]
            ScheduledTask["ScheduledTaskService.ts<br/>定时发布编排"]
            TaskStorage["TaskStorage.ts<br/>定时任务存储"]
            PlatformScheduler["PlatformScheduler.ts<br/>平台调度抽象"]
            CronManager["CronManager.ts<br/>cron 管理"]
            WindowsTaskScheduler["WindowsTaskScheduler.ts<br/>Windows Task Scheduler 管理"]
            QrLogin["QrLoginService.ts<br/>纯 HTTP 二维码登录"]
            Zse96Signer["Zse96Signer.ts<br/>x-zse-96 签名生成"]
            CookieManager["CookieManager.ts<br/>Cookie 持久化与验证"]
            SettingsService["SettingsService.ts<br/>VSCode 配置读写"]
        end

        subgraph cli["cli/"]
            CLIIndex["index.ts<br/>zhihupost-publish 入口"]
            CLIPublisher["CLIPublisher.ts<br/>定时任务执行"]
            CLILogger["CLILogger.ts<br/>CLI 日志"]
        end

        subgraph types["types/"]
            ScheduledTaskType["ScheduledTask.ts<br/>定时任务类型"]
        end
        
        subgraph utils["utils/"]
            extractTitle["extractTitle.ts<br/>提取 Markdown 标题"]
            MarkdownRenderer["MarkdownRenderer.ts<br/>Markdown → 知乎 HTML"]
            ImageUploader["ImageUploader.ts<br/>图片上传到知乎 CDN"]
        end
        
        subgraph test["test/"]
            subgraph unit["unit/"]
                extractTitleTest["extractTitle.test.ts"]
                MarkdownRendererTest["MarkdownRenderer.test.ts"]
                Zse96SignerTest["Zse96Signer.test.ts"]
                CookieManagerTest["CookieManager.test.ts"]
                SettingsServiceTest["SettingsService.test.ts"]
                BatchPublishServiceTest["BatchPublishService.test.ts"]
                ImageUploaderTest["ImageUploader.test.ts"]
                QrLoginServiceTest["QrLoginService.test.ts"]
            end
            mocks["__mocks__/"]
        end
    end
    
    subgraph docs["docs/"]
        PRD["PRD.md"]
        ARCHITECTURE["ARCHITECTURE.md"]
        DEVLOG["DEVLOG.md"]
    end
    
    subgraph media["media/"]
        icon["icon.png"]
        icons["icons/"]
    end
    
    packageJson["package.json"]
    tsconfig["tsconfig.json"]
    jestConfig["jest.config.js"]
    gitignore[".gitignore"]
    README["README.md"]
    
    Root --> src
    Root --> docs
    Root --> media
    Root --> packageJson
    Root --> tsconfig
    Root --> jestConfig
    Root --> gitignore
    Root --> README
    
    src --> extension
    src --> services
    src --> cli
    src --> types
    src --> utils
    src --> test
    
    services --> ZhihuApi
    services --> BatchPublish
    services --> ScheduledTask
    services --> TaskStorage
    services --> PlatformScheduler
    services --> CronManager
    services --> WindowsTaskScheduler
    services --> QrLogin
    services --> Zse96Signer
    services --> CookieManager
    services --> SettingsService
    cli --> CLIIndex
    cli --> CLIPublisher
    cli --> CLILogger
    types --> ScheduledTaskType
    
    utils --> extractTitle
    utils --> MarkdownRenderer
    utils --> ImageUploader
    
    test --> unit
    test --> mocks
    
    unit --> extractTitleTest
    unit --> MarkdownRendererTest
    unit --> Zse96SignerTest
    unit --> CookieManagerTest
    unit --> SettingsServiceTest
    unit --> BatchPublishServiceTest
    unit --> ImageUploaderTest
    unit --> QrLoginServiceTest
    
    docs --> PRD
    docs --> ARCHITECTURE
    docs --> DEVLOG
    
    media --> icon
    media --> icons
    
    style Root fill:#e3f2fd,stroke:#1565c0
    style src fill:#fff9c4,stroke:#f57f17
    style docs fill:#e8f5e9,stroke:#2e7d32
    style media fill:#f3e5f5,stroke:#7b1fa2
```

## 8. 依赖

| 包 | 版本 | 用途 |
|----|------|------|
| `node-fetch` | ^3.x | HTTP 请求（API 调用） |
| `markdown-it` | ^14.1.0 | Markdown 解析 |
| `@types/vscode` | ^1.80.0 | VSCode API 类型 |
| `typescript` | ^5.9.3 | 编译 |
| `jest` | ^30.3.0 | 测试 |
| `ts-jest` | ^29.4.9 | Jest TypeScript 支持 |

## 9. 常量配置

```typescript
// API 端点
const ZHIHU_API_BASE = 'https://www.zhihu.com';
const ZHIHU_ZHUANLAN_API_BASE = 'https://zhuanlan.zhihu.com';
const QR_LOGIN_URL = 'https://www.zhihu.com/api/v3/account/api/login/qrcode';

// 签名
const X_ZSE_93 = '101_3_3.0';

// 登录
const LOGIN_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;

// Cookie 存储
const COOKIE_FILE = '~/.zhihupost/cookies.json';
const COOKIE_DIR = '~/.zhihupost';

// HTTP
const REQUEST_TIMEOUT_MS = 15_000;
const RETRY_COUNT = 1;
const RETRY_DELAY_MS = 2_000;

// 图片上传
const POLL_MAX_ATTEMPTS = 15;
```
