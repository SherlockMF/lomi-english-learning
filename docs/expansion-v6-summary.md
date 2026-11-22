# Expansion V6 词库扩充汇总

2026-11-20/21 完成。面向海外中国大学生的词库大扩充：在原 7,263 条 bundled 种子词基础上新增 **29,959 条**，应用种子词库总量达到 **37,222 条**（37,462 含 240 条 handcrafted，词典义项另计）。

## 覆盖分类（26 个系统词单）

原有 4 分类保留并扩充：daily（+2,072）、business（+1,021）、finance（+1,022）、accounting（+769）。

新增通识场景 14 类：campus 1,989 · housing 1,215 · health 1,238 · money 979 · career 1,475 · food 987 · travel 991 · government 982 · emergency 748 · shopping 993 · social 1,240 · entertainment 1,008 · digital 1,002 · communication 788。

新增专业选修 8 类：cs 1,712 · economics 1,061 · math 928 · engineering 1,331 · medicine 1,342 · law 1,064 · psychology 1,066 · marketing 936。

## 目录结构

- `data/vocabulary-packs/expansion-v6/chunks/` — 236 个生成 chunk（每类按子主题拆分，约 125 词/chunk），生成规范见 `expansion-v6/GENERATION_GUIDE.md`
- `data/vocabulary-packs/expansion-v6/packs/` — 26 个按分类合并的 pack（words + memberships，membership 带 subcategory）
- `data/vocabulary-packs/expansion-v6/validation/latest-validation.json` — 机械校验报告
- `scripts/validateExpansionPack.mjs` — 机械校验（schema/例句/搭配/id 格式/查重），npm run expansion:validate
- `scripts/buildExpansionPack.mjs` — chunk → pack 合并，npm run expansion:build
- `scripts/buildBundledExpansionPack.mjs` — pack → bundled seed 合并（幂等，可重复运行），npm run expansion:bundled

## 质量关卡

1. **机械校验 0 错误**：字段完整、每词恰好 2 条中英例句（中文「」标注目标词）、3 条搭配、id/senseKey 全局唯一（v6-<category>-<slug>-<8hex> / v6:<category>-<hex>）、词内与跨 chunk 查重、对 v5.2 基础库查重。
2. **同义仲裁**：42 条与 v5.2 同表达的词条逐一比对释义——32 条为合法"同词不同义"（hook 钩→文章引子、abstract 抽象的→摘要、text 文本→发短信等）保留；10 条同义重复（anxious/jealous/stress/confidence/shortly/constantly/shower/dry/block/sticky）删除。
3. **跨分类查重**：唯一跨分类重复为 open house（campus 开放日 / housing 看房开放日），义项不同，双保留。全局 id/senseKey 无冲突。
4. **语义复核（7 个分组 reviewer agent，26 分类全覆盖）**：逐文件通读全部 29,959 词，校核义项正确性、定义一致性、例句自然度、词性、搭配、CEFR，以及专业术语与中国教材/行业惯例译名的对齐。累计修复约 320 处（生造译名、错译、翻译腔、词性错标、英美语境混用、a/an 冠词、音译错误等），并在约 60 处 acceptedZhAnswers 中补充教材标准译名（如转动惯量、纯滚动、动能定理、庞纳特方格、辩诉交易、经典条件反射）。无词条删除。
5. **遗留质量禁令兼容**：15+6 条 v6 定义改写以通过 v5.2 时代的模板定义禁令（"sense of…" / " relating to " 句式）。

## 应用接入

- `src/domain/types.ts`：SystemListSlug 扩展至 26 个系统分类。旧设置缺少分类选择时沿用日常、商业、金融、会计四类。
- `src/data/vocabularyLists.ts`：27 个词单（26 系统 + my-vocabulary）。
- `src/lib/scheduler.ts`：选中方向按顺序使用 N 到 1 的权重，依首次学习记录跨天分配普通新词。
- `src/components/OnboardingDialog.tsx` 和 `src/components/LibraryView.tsx`：首次选择后即可开始第一课，后续可在词库勾选或调整优先级。停学某方向后，已学词继续安排复习。
- `public/data/bundledSeedWords.json` + `bundledSeedMemberships.json`：合并后的 bundled 种子（v6 词已生成 cloze/sentence usagePrompts）。
- `src/data/seedContentRevision.ts`：完整词库内容修订为 6.0.1。原有账号以 5.3.3 更新基础词库正文，可在「管理学习词库」保存选项后按方向加入 V6 义项。
- `data/dictionary-senses/report.json`：新增 29,883 条 not-found unresolved 记录，词典覆盖账目与全量词库平衡（37,415 个唯一表达）。后续可对 v6 表达跑词典义项 enrich 管线。

## V5.2 例句全量重写（2026-11-22）

用户反馈 v5.2 老库例句"太呆"（如 underwater 词条配 "The terms are underwater" 模板句）。骨架聚类审计确认 **14,722 条例句中 93% 来自 161 个模板家族**（最大家族 1,486 句），946 条中文例句含"的的"类错字或直译。

重写流水线（`scripts/splitV52Rewrite.mjs` → 22 个工作文件 → 11 组重写 agent → `scripts/mergeV52Rewrite.mjs` 回写 trusted pack → `buildBundledSeedPack` 重建）：

- 复核源词包 7,361 个义项，其中 7,360 个义项更新了例句。生成正式产物后，7,262 个义项的双语例句和用法练习同步更新。
- 对比上一版正式产物，859 个中文释义和 431 个英文定义有调整。例如 `underwater` 的金融义改为「资不抵债的」。
- 原词条 ID 和分类归属保留，个人词条编辑、词库选择和复习记录沿用现有数据。
- 回归审计：模板家族 161 → **0**（v5.2 与 v6 双双 0%），zh 异常 946 → **0**

工具链：`scripts/auditTemplateExamples.mjs`（v5.2）与 `scripts/auditV6TemplateExamples.mjs`（v6）可随时对新词跑模板回归。

## 已知权衡

- bundledSeedWords.json 约 58 MB（未压缩）。新账号首开一次性写入完整种子，旧账号按原选择加入 V6 内容。
- v6 词条 vocabularyLevel 覆盖率约 13%（生成时"有把握才标"）；未标注词条沿用应用内 lexicon/profile 估算（默认 B2）。
- 词典义项 enrich（wordSenses）尚未覆盖 v6 表达（unresolved 记账已就位）。

## 测试

词条检查使用 `npm run expansion:validate`，发布产物使用 `npm run build`。
