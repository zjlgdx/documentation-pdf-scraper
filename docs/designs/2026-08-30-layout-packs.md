# Layout Packs for Book-like PDF Typography

**Date:** 2026-08-30

## Context

项目当前已经具备可靠的 Markdown → Pandoc/XeLaTeX → PDF → PyMuPDF 验证链路，但排版策略分散在配置默认值、Kindle 分支、Pandoc 参数、共享 LaTeX header 和验证器中：配置按 base、doc target、`PDF_PROFILE` 顺序深合并后才做 Joi 校验（`src/config/configLoader.js:31`），Pandoc 服务独立计算纸张、边距、字号和行距（`src/services/pandocPdfService.js:471`），验证器又从配置重新推导同一组物理参数（`src/services/pdf/pdfVerification.js:15`）。这会妨碍新增一套类似小开本书籍、但仍能承载目录、代码、表格、图片和英语批注的阅读版式。目标是引入一个默认关闭、边界清晰、将来可抽成扩展包的 Layout Pack 机制，并以 `reading-5x8` 作为首个实现；没有选择 preset 时，现有 A4 与 Kindle 输出必须保持不变。

## Discussion

- 参考项目的价值主要在排版原则，而非可直接复用的代码：明确的 5×8 英寸页面网格、衬线正文与无衬线页眉的角色分工、克制的章节开场、运行页眉和孤行控制都值得吸收；它是手工编排的线性文章，未覆盖本项目的目录、代码、表格、图片、批注和自动验证，因此不能作为模板直接移植。设计只学习原则，不复制其 LaTeX 实现。
- “直接在 `PandocPdfService` 增加 5×8 条件分支”实现最短，但会继续扩大现有 Kindle 特例，也无法解决渲染器与验证器各自推导页面事实的问题，否决。
- “立即发布独立 npm 包并允许第三方插件动态加载”边界最彻底，但当前仓库不是 workspace，只有一个消费者和一个新 pack；发布、兼容、信任与版本治理成本缺乏真实需求支撑，否决。
- 采用“仓库内部、可提取的 Layout Pack 边界”：先稳定 registry、spec、Pandoc adapter 和 verification contract；出现第二个真实消费者、至少两个稳定 pack，且 contract 不再频繁变化后再抽包。
- Pack 对页面、边距、字体、字号、行距、单双面、页眉页脚、段落与分页策略拥有完整控制权，不开放任意 TeX 或自由覆盖。选择 preset 的同一配置层若还声明这些旧字段，必须 fail closed，并报告冲突字段路径。
- `config.json` 当前显式提供 A4/20mm，而 `reading-5x8` 将由更高优先级的 `PDF_PROFILE` 选择。为避免“选 preset 必然与继承值冲突”，preset 是一个原子布局边界：选择层之下继承的布局字段被 pack 完整遮蔽；只有选择层自身同时声明的直接布局字段算冲突。Joi 注入的默认值也不算显式冲突。实现必须保留各配置层的来源信息，不能在深合并后猜测来源。
- 中文排版基线以 W3C《中文排版需求》Group Note Draft 作为设计指导而非合规标准：宋体类适合正文、黑体类适合标题；10.5pt 是其列举的常见正文字号；约 27 个全角字的行长落在常见书籍正文 17–40 字范围内；1.5 倍行高处于建议字面高度 50%–100% 行间空白的下沿；技术文档采用该资料列举的“不缩进＋段间距”模式；分页遵循“孤字不成行、孤行不成页”，但不用绝对惩罚制造大片空白。
- Pandoc 官方变量负责 document class、字体、纸张与 geometry；KOMA-Script `scrartcl` 负责可变字号和章节结构，`scrlayer-scrpage` 负责运行页眉；`geometry` 负责自定义物理尺寸；`fontspec`/`xeCJK` 负责系统字体和中文标点。`xeCJK` 使用 `kaiming`，不照搬参考项目关闭标点调整的 `plain`。
- V1 面向单面数字阅读，不做封面、任意布局 DSL、运行时第三方 pack 下载、Puppeteer PDF adapter 或动态 TeX 注入。Kindle 实机阅读是后续人工验收项，不能由桌面渲染或静态检查代替。

## Approach

新增一个受信任、声明式的 Layout Pack 层。`PDF_PROFILE=reading-5x8` 只选择 `pdf.layoutPreset: "reading-5x8"`；`LayoutRegistry` 将其解析为冻结、经过闭合 schema 校验的 `LayoutSpec`，Pandoc adapter 把 spec 翻译为现有 CLI 变量和受控 header 行为，PDF verifier 从同一 spec 获取物理尺寸、内容区、页眉页脚允许区和字体预期。选择、冲突、renderer 与字体预检都在采集前完成。该方案既消除渲染/验证双重事实来源，又不把当前仓库过早升级成插件平台。

## Architecture

### Data flow and ownership

```text
config.json + doc target + PDF_PROFILE（保留来源）
                    │
                    ▼
       preset 选择与同层冲突检查
                    │
                    ▼
            LayoutRegistry.resolve()
                    │
                    ▼
         frozen, validated LayoutSpec
              ┌─────┴──────────┐
              ▼                ▼
     PandocLayoutAdapter   PDF verification
     CLI + trusted header  geometry + fonts + previews
```

- `src/config/configValidator.js` 在 `pdf` 下增加可选的 `layoutPreset` 标识符；它只接受名称，不接受内联 spec 或 TeX。现有 `fontSize`、`lineHeight`、`format`、`pageFormat`、`margin`、`markdownPdf.pdfOptions` 和 CJK 字体仍用于 legacy/Kindle 路径。
- `src/config/configLoader.js` 在合并时记录字段来源层。preset 选择层的受控字段集合必须为空；更低层的同类字段被原子遮蔽，schema 默认不参与冲突判断。未选择 preset 时继续走现有深合并和默认值语义。
- 新增 `src/services/pdf/layouts/layoutSpecSchema.js`、`layoutRegistry.js`、`packs/reading5x8.js` 与 `pandocLayoutAdapter.js`。registry 只注册仓库内受信任模块，拒绝未知 id、重复 id、无 version、非闭合字段及 renderer 不兼容。
- `src/core/setup.js:173` 给 `PandocPdfService` 注入已解析的 layout；layout resolver 加入关键服务预加载（当前列表在 `src/core/setup.js:214`），使错误早于 scraper 初始化。
- `src/services/pandocPdfService.js:458` 不再把单一全局 header 当作所有布局的最终事实。adapter 组合“现有内容安全/批注能力”和“pack 的受控排版策略”；未选择 preset 时返回与当前参数和 header 等价的 legacy 结果。
- `src/services/pdf/pdfVerification.js:15` 接收 resolved layout expectations，不再为 preset 独立重建纸张/边距。`src/python/verify_pdf.py:38` 扩展字体与家具区检查，并把 layout id、version、fingerprint 写入 `report.json`。
- `src/utils/toolchain.js:4` 对 pack 所需字体运行一个最小 XeLaTeX/fontspec 探针，验证实际 renderer 能按精确名称加载全部字体；不接受 `fc-match` 自动替代。缺失字体时列出 pack 和字体名称并在采集前失败。
- `src/services/stateManager.js:260` 已在 Markdown batch 模式把 `pdf` 排除出采集 identity。继续保持此行为：layout id/version/fingerprint 属于渲染和 QA 报告，不应迫使重新抓取或翻译 Markdown。

### Closed LayoutSpec contract

`LayoutSpec` 只含可序列化、白名单字段：

- identity：`id`、`version`、`renderer: "pandoc-xelatex"`；fingerprint 由规范化 spec 计算，不由 pack 自报。
- page：物理宽高、四边 body margin、单/双面；所有长度必须带允许单位且为正值。
- typography：正文、标题、等宽字体的精确名称，正文字号、视觉行高、标题层级比例、中文标点枚举。
- paragraphs：首行缩进、段间距；pagination：widow/orphan/display-widow penalty、`raggedBottom`、标题 keep-with-next。
- furniture：运行页眉模式、首页模式、页码模式、长 mark 的确定性截断上限；不接受任意模板字符串。
- content：代码字号与换行策略、表格和图片的最大内容区占用策略。
- verification：期望页面尺寸、body bounds、允许的 header/footer zones、必需字体族和应渲染的语义页面类型。字体项同时记录 XeLaTeX 请求名称与允许的 PDF 内嵌 PostScript 名称；这是为了处理 Noto CJK TTC 的共享内部名称，不是字体 fallback。

adapter 是唯一允许把这些枚举/数值映射为 LaTeX 的位置；配置、pack spec 和报告中均不得携带原始 LaTeX。所有对象在注册时深冻结，运行中不得修改。

### `reading-5x8` V1 baseline

| 维度 | 决策 |
|---|---|
| 页面 | 5×8in，即 360×576pt；单面，左右 body margin 0.5in，上下 0.65in |
| 正文 | Noto Serif CJK SC，10.5pt，视觉行高 1.5；4in 行宽约容纳 27 个全角字 |
| 标题与家具 | Noto Sans CJK SC；H1/H2/H3 为 17/14/12pt；运行页眉 8.5pt |
| 代码 | DejaVu Sans Mono，8.5pt；保留现有安全换行、长 URL 和 fenced/verbatim 处理 |
| 中文标点 | `xeCJK` `PunctStyle=kaiming` |
| 段落 | 首行不缩进，段间距 0.6em；保留 Markdown 的逻辑段落边界 |
| 页眉页码 | 正文页左侧为经清洗、最长 28 个全角单位的章节 mark，右侧页码；章节首页无页眉、页码居中页脚，并留约两行开场空间 |
| 目录 | 延续当前罗马数字目录、阿拉伯数字正文及可点击链接/书签行为（现有切换见 `src/services/pdf/pandocTemplate.js:116`） |
| 分页 | widow/orphan/display-widow penalty 8000，标题 keep-with-next，启用 `raggedbottom`；不使用 10000 绝对惩罚 |
| 图表与批注 | 图片、表格和英语批注盒不得超过 body bounds；小开本允许跨页盒，禁止横向缩小正文来掩盖溢出 |

`lineHeight: 1.5` 是领域值；Pandoc/KOMA adapter 负责换算为相对于 TeX 默认约 1.2 的 `linestretch`，不能把 1.5 原样当 `linestretch` 再放大一次。运行页眉使用 KOMA 的 `scrlayer-scrpage`，不复制参考项目的 `fancyhdr` 做法。家具区必须独立于 body bounds：验证器只允许匹配 pack 家具规则的重复页眉或页码进入相应区域，正文和图片仍按 body bounds 判溢出。

### Errors, observability, and extraction

- 未知 preset、非法 spec、同层字段冲突、不支持的 renderer、缺少字体均抛出 `ValidationError`；信息包含 preset id 与确切字段/字体，禁止静默回退 legacy 或替代字体。
- 每次渲染在日志与 QA `report.json` 记录 layout id、version、fingerprint、有效页面尺寸和字体；同一个 spec 必须产生稳定 fingerprint。
- 首阶段不增加新的 CLI 入口。沿用 `PDF_PROFILE`，新增 `config-profiles/reading-5x8.json` 和文档命令示例。
- 只有在第二个真实消费者、至少两个稳定 pack、registry/adapter/verification contract 已稳定三个条件同时满足时，才把目录抽为独立包；抽取不得改变现有 profile 或报告格式。

## Testing

- `tests/config/configLoader.test.js`：证明来源层被保留；同层 `layoutPreset + margin/fontSize/pdfOptions` 失败；低层 A4 值被 preset 原子遮蔽；Joi 默认不触发冲突；无 preset 保持现有结果。
- 新增 layout schema/registry 单元测试：合法 pack 深冻结；未知/重复 id、未知字段、非法单位、缺 version、renderer 不匹配均失败；fingerprint 稳定且 spec 变化会改变 fingerprint。
- `tests/services/pandocPdfService.test.js`：无 preset 的规范化 CLI 参数与共享 header 保持现有快照；`reading-5x8` 生成 `scrartcl`、自定义 `paperwidth/paperheight`、正确的 10.5pt 与 line-stretch 换算、字体、`kaiming`、`scrlayer-scrpage` 和分页策略，且没有用户原始 TeX 通道。
- `tests/utils/processRunner.test.js` 或独立 toolchain 测试：精确字体探针全部存在时通过，缺一个字体时在采集前失败，错误不得把相似字体或 `fc-match` fallback 当成功。
- 扩展 `tests/python/test_verify_pdf.py`：360×576pt 容差、必需字体族、body/header/footer 分区、长页眉截断、正文进入家具区、家具进入正文区、缺字与溢出的正反例。
- 扩展 `tests/fixtures/pdf/article.md`，覆盖长中英标题、中文标点、普通/高亮代码、长 URL、表格、截图、英语批注盒和跨页内容。`PDF_PROFILE=reading-5x8 make pdf-smoke` 必须同时验证页面尺寸、边距、字体、TOC 链接/书签、正文片段、图片和零溢出。
- QA 预览必须包括目录、首个章节首页、长标题、代码、表格、图片/批注和末页；人工检查构图、层级、留白、密度、字体角色、页眉截断及连续翻页节奏。自动报告仍返回 `visualReview: required`（当前约束见 `src/python/verify_pdf.py:167`）。
- 回归门槛：`make clean && npm test && npm run lint`，随后分别运行默认 A4 和 `reading-5x8` smoke；默认路径不得出现页面、TOC、字体、批注或预览选择漂移。Kindle 实机阅读单列为剩余验收，不据此阻塞内部结构测试，但不得宣称已验证实机体验。

## References

- 灵感来源：[HEJustinSun/my-girlfriend-jingtian-latex `main.tex`](https://github.com/HEJustinSun/my-girlfriend-jingtian-latex/blob/main/main.tex)。仅提取页面网格与层级原则，不复制实现。
- 排版需求资料：[W3C Requirements for Chinese Text Layout](https://www.w3.org/TR/clreq/)（Group Note Draft，不作为规范性合规标准）。用于字体角色、字号、行长/行距、段落模型、标点与孤行孤字原则。
- 转换器契约：[Pandoc User's Guide](https://pandoc.org/MANUAL.html)。用于 `documentclass`、`classoption`、`geometry`、`linestretch`、`pagestyle`、`papersize` 与字体变量边界。
- 文档类与页眉：[KOMA-Script](https://ctan.org/pkg/koma-script) 及其[官方手册](https://mirrors.ctan.org/macros/latex/contrib/koma-script/doc/scrguide-en.pdf)。用于任意字号、章节结构和 `scrlayer-scrpage`。
- 页面几何：[geometry](https://ctan.org/pkg/geometry) 及其[官方手册](https://mirrors.ctan.org/macros/latex/contrib/geometry/geometry.pdf)。用于自定义物理页面和单/双面 margin 语义。
- 字体与中文标点：[fontspec](https://ctan.org/pkg/fontspec)、[xeCJK](https://ctan.org/pkg/xecjk) 及 [xeCJK 官方手册](https://mirrors.ctan.org/macros/xetex/latex/xecjk/xeCJK.pdf)。用于 XeLaTeX 字体预检、CJK 字体与 `kaiming` 标点策略。
