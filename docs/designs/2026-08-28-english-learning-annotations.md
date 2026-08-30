# English Learning Annotations for Documentation PDFs

**Date:** 2026-08-28

## Context

项目目前可以把原生 Markdown/MDX 或浏览器提取内容转换为 Markdown，再通过 Pandoc/XeLaTeX 生成 PDF；翻译是现有的一种可选 Markdown 派生阶段。新功能面向英文文档阅读者：保留英文原文，并根据初中、高中、大学三个英语水平，在原文附近插入中文学习批注，解释生词、短语动词、俚语、惯用语、搭配、地道表达和必要的技术术语。

该功能的核心不是“把英文翻成中文”，而是帮助读者注意到自己大概率不熟悉、但值得学习的表达。批注需要与原文精确对应，不能改写正文、污染代码或链接，也不能为了凑数量而解释目标水平已经掌握的基础词。

V1 的目标是：

- 保留可审计的英文原始 Markdown，并生成独立的 `_annotated.md`。
- 用 Markdown AST 识别可批注文本和受保护内容。
- 通过用户已有的 OAuth 订阅调用模型，不要求 API key。
- 默认使用 AGY 的 Gemini Flash，失败时使用 Codex Luna 兜底。
- 让批注在普通页面和 Kindle Scribe 页面上都可稳定排版、可读且不截断。

V1 不包含全文翻译与批注同时启用、自动判断整个站点语言、代码/表格/标题批注、PDF 坐标级旁注、网页编辑器、模型微调，以及每批内容的双模型自动复审。

## Discussion

### Output choice

采用“英文原文 + 相邻中文批注框 + 篇末学习回顾”。不在正文内插入上标编号，也不做页边坐标定位。相邻批注保留阅读顺序；每篇最多三个回顾问题把被动重读转为主动回忆。两类内容使用不同的语义化 fenced div，并由 Pandoc 映射为可跨页的低对比度灰阶框，减少窄页面和 Kindle 版式中的脆弱行为。

示例输出：

```markdown
The framework does most of the work under the hood.

::: english-annotation
**英语批注 · 高中**

- **under the hood**（惯用语）：表示系统内部实际发生的事情。

  **例句：** Under the hood, the app checks every file.
:::

::: english-learning-review
**学习回顾 · 先不看批注**

1. **under the hood**：为什么这个表达适合描述用户看不到的内部实现？
:::
```

### Model routing

基于多组 OAuth 实测，主模型选择 `agy / gemini-3.7-flash-high`。它在“不需要批注时保持克制”和按英语水平控制解释密度方面更符合本功能，也更接近用户偏好的自然文风。`codex / gpt-5.6-luna / xhigh` 在表达召回和上下文完整性上表现较好，作为一次性失败兜底。

这不是抽象的“哪个模型更强”结论，而是针对本批注任务的路由决定。由于两者都走订阅 OAuth，设计不使用 API token 单价做运行时选择，也不配置 API key。CI 和普通单元测试不得实际消耗 OAuth 调用。

每批先调用主模型。仅在进程错误、超时、输出信封无法解析、结构不合法、缺少 segment、锚点无效或违反确定性约束时调用一次兜底模型。合法的空批注是成功结果，不触发兜底。兜底仍失败时终止当前页面/任务并给出可操作错误，不静默生成缺少批注的 PDF。

### Level and density

英语水平和批注密度是两个独立维度：

- `junior-high`：解释常见但超出初中范围的词组、搭配和表达。
- `high-school`：忽略大部分基础词，强调可迁移短语、语法、篇章逻辑、语域和写作句型。
- `university`：只解释不透明、专业性强、语用特殊、结构上值得学习或概念上关键的目标。
- `light`、`standard`、`dense` 分别允许每个文本段最多 1、2、3 条批注。

批注对象不限于单词和短语。完整类型还包括 `grammar-pattern`、`discourse-logic`、`register-usage`、`writing-pattern` 和 `concept`；高阶类型锚定能识别结构或概念的最短原文片段，避免给整句或整段制造大面积标记。

高等级意味着更少的基础词解释，而不是强制减少所有类型的批注。密度始终是上限而不是配额，模型可以为任意段返回零条。选择顺序优先“妨碍理解的表达”“能迁移到其他语境的语言模式”和“支撑当前内容理解的关键概念”；跳过专有名词、产品标签、语义透明的词组、目标水平通常已掌握的标准术语，以及同一批次中没有新义的重复表达。完整多词表达优先于其中价值较低的单词。

释义使用简洁、与当前语境对应的中文；例句使用新的自然英文句子，不照抄原文。高价值的语法、篇章、写作或概念批注可以附带一个中文 `learningPromptZh`，问题采用 why/how/compare/what-if 等需要解释的形式，不在问题中泄露答案。渲染阶段每篇最多选择三个问题组成“学习回顾”，优先保留语法、篇章、语域、写作和概念类问题，再用词汇问题补足。

## Approach

### Configuration

新增顶层 `annotations` 配置，默认关闭。字段先进入 Joi schema，再进入配置文件：

```json
{
  "annotations": {
    "enabled": false,
    "provider": "agy",
    "model": "gemini-3.7-flash-high",
    "level": "high-school",
    "density": "standard",
    "explanationLanguage": "Simplified Chinese",
    "timeout": 300000,
    "fallback": {
      "provider": "codex",
      "model": "gpt-5.6-luna",
      "reasoningEffort": "xhigh"
    }
  }
}
```

启用批注时必须同时启用 `markdown.enabled` 和 `markdownPdf.enabled`。V1 中 `translation.enabled` 与 `annotations.enabled` 互斥，配置加载时直接报错。功能显式启用，不根据页面内容隐式开启。

### AST segmentation and protected content

批注服务解析 Markdown AST，而不是用全局正则修改文本。它为合格的段落和列表项正文生成稳定 `segmentId`，并保留原文与位置。以下内容不可作为锚点：frontmatter、标题、代码块、行内代码区间、链接目标和 URL、表格、原始 HTML/MDX。非英文或明显混合语言的段落由确定性规则跳过。

行内代码仍保留在提供给模型的上下文中，但其范围标记为受保护。模型只能选择同一 segment 内连续、精确存在的英文片段；服务在 `_annotated.md` 中用语义化 span 标记已验证的原文锚点，并在 AST 节点边界插入批注块。原始 `.md` 和原文可见字符不变。

### Model contract and validation

每个请求包含有界的未缓存 segment，初始内部限制为最多 12 段或约 6000 个字符，批注并发为 1，以降低订阅限流和 CLI 进程竞争。模型必须返回每个 `segmentId`，即使其 `annotations` 为空。单条批注结构为：

```json
{
  "quote": "under the hood",
  "occurrence": 1,
  "type": "idiom",
  "explanationZh": "表示系统内部实际发生的事情。",
  "exampleEn": "Under the hood, the app checks every file.",
  "learningPromptZh": "为什么这个表达适合描述用户看不到的内部实现？"
}
```

`type` 允许 `word`、`phrasal-verb`、`idiom`、`collocation`、`native-expression`、`technical-term`、`slang`、`grammar-pattern`、`discourse-logic`、`register-usage`、`writing-pattern`、`concept`。确定性验证器对每批执行：

- 响应覆盖所有且仅包含已请求的 segment。
- `quote` 在对应原文中精确存在，`occurrence` 能唯一定位。
- 锚点不与受保护范围相交。
- 同一段内无重复或重叠批注。
- 类型与密度上限符合提供方支持的 schema 子集；本地验证器另行检查字符串长度、释义含中文、例句构成英文句子。
- 每段至多一个非空学习问题，且问题含中文；每篇渲染至多三个回顾问题。

模型风格判断不进入硬编码词表；可机械验证的事实全部由本地验证器负责。

### Cache, resume, and artifacts

缓存位于 `.temp/annotation_cache`，缓存键至少包含 segment 原文哈希、主/兜底路由配置、模型、reasoning effort、level、density、解释语言，以及 prompt/schema/contract version。只缓存通过验证的最终结果，并在缓存记录中保存实际命中的提供方。`make clean-cache` 应通过现有 `.temp` 清理语义移除它。

批注配置、annotation contract version 和 render version 必须进入 `StateManager` 的采集身份，使等级、模型、提示契约或锚点呈现变化会废弃旧的 `_annotated.md`；render version 不进入模型缓存键，因此纯视觉变化可复用已验证的模型结果。只更换 PDF profile 仍可复用同一 Markdown 产物。

每页始终写入原始 `.md`。批注成功后再写 `_annotated.md`，并把后者作为当前运行 artifact manifest 中的选定 Markdown。批处理 PDF 继续读取 manifest，不通过扫描目录猜测变体。批注缓存是派生加速数据，不成为内容 metadata 的第二真相源。

### Failure and observability

日志使用现有 logger，记录页面、批次、主模型结果、兜底原因、缓存命中数和最终提供方，但不记录完整文档、OAuth 凭据或模型内部输出。缺少 CLI、OAuth 未登录、超时和双提供方失败需要不同的错误信息。保护性定时器必须在 `finally` 中清理，并在适用时 `unref()`，避免 Vitest 或主进程残留句柄。

## Architecture

数据流为：

```text
acquired Markdown
  -> original artifact (.md)
  -> AST segmenter and protected-range map
  -> annotation cache lookup
  -> AGY client -> deterministic validator
                    | invalid/failure
                    v
                 Codex client -> deterministic validator
  -> AST-adjacent annotation renderer
  -> annotated artifact (_annotated.md)
  -> current-run artifact manifest
  -> Pandoc/XeLaTeX -> verified PDF and previews
```

主要组件边界：

| Component | Responsibility |
| --- | --- |
| `annotationService` | AST 分段、批处理、验证编排、缓存和 Markdown 插入 |
| `agyAnnotationClient` | AGY OAuth CLI 参数、stdin/stdout 信封和超时 |
| `codexAnnotationClient` | Codex OAuth CLI、Luna reasoning effort、JSONL/最终消息解析 |
| `configValidator` | 默认值、枚举、Markdown 前置条件和翻译互斥 |
| `scraper` | 在原始 Markdown 写入后调用批注阶段并选择 artifact |
| `stateManager` | 把批注契约纳入 resume identity，验证 artifact 哈希 |
| `pathService` | 提供注解缓存和 `_annotated.md` 的受控、安全路径 |

两个 CLI 客户端共享一个最小接口，但不强行复用现有 `CliJsonTranslationClient`：AGY 和 Codex 的启动参数、输出信封及 schema 能力不同。只有在实现时证明生命周期代码完全相同，才抽取通用进程辅助函数。

原文锚点使用语义化 span，并通过一个只处理该 class 的最小 Lua filter 映射为中性点状下划线。点状下划线沿用“该文本有补充说明”的常见视觉约定，不使用已被拼写/语法检查广泛占用的波浪线，也不依赖颜色传达含义；矢量绘制不会向复制、搜索和朗读所用的文本层注入标记字符。

即时批注和篇末回顾分别使用 `english-annotation` 与 `english-learning-review` fenced div。Lua filter 只在 LaTeX 输出中将它们映射为两个可跨页 `tcolorbox`：即时批注采用更轻的底色、左侧强调线和小字号，紧邻目标段落；学习回顾使用略强边框并与正文留出更大前距。框内顺序固定为“原文对象 → 类型/IPA → 语境义 → 新例句”，不依赖颜色区分类别，也不把解释挤进正文行间。

## Testing

单元测试覆盖 AST 保护范围、重复短语 occurrence、所有等级和密度、合法空结果、过度批注、非法锚点、缺失 segment、兜底触发、双失败、缓存键版本变化，以及 provider 信封/超时/进程终止。CLI 测试使用 mock spawn，不进行真实 OAuth 请求，并验证定时器和子进程均被清理。

配置和集成测试覆盖 Markdown 前置条件、翻译互斥、原始与 `_annotated.md` 产物、原文锚点、失败时不发布 manifest、level/model/contract/render 改变导致 resume 失效，以及 PDF profile 改变仍能复用批注 Markdown。将实测使用的六类文本整理成固定评测夹具，分别覆盖俚语、技术文档、水平差异、重复短语、无需批注和混合代码；自动测试验证结构与边界，文风质量保留为人工抽样检查。

实现阶段的最小验证门槛：

- `make clean && make test`
- `make lint`
- `node scripts/test-config-loading.js`
- `make pdf-smoke`
- `PDF_PROFILE=kindle-scribe make pdf-smoke`

必须人工查看生成的 PNG 预览，确认每条批注的原文锚点有清晰点状下划线、原文可见字符未变、批注紧邻目标段落、标题/类型/释义/例句层级稳定、即时批注与学习回顾能一眼区分、中文字体正常、长批注可跨页、无孤立标题或边界裁切，并检查 TOC 与后续段落没有回归。获得明确授权后，再用小型英文目标做一次真实 OAuth 端到端验证；报告中分别标注采集、批注、渲染和视觉证据。

## Assumptions

- AGY 与 Codex CLI 已通过各自订阅 OAuth 登录；用户不需要在项目中保存 API key。
- `gemini-3.7-flash-high` 和 `gpt-5.6-luna` 是当前本地 CLI 可解析的模型标识；若提供方重命名模型，只更新配置默认值和对应契约测试。
- V1 的中文解释使用简体中文，后续可以扩展语言枚举，但不在首版引入自由格式提示词。
- 自动运行只做确定性验证；5% 至 10% 的双模型或人工抽样属于发布质量流程，不是每次生成 PDF 的运行时步骤。
