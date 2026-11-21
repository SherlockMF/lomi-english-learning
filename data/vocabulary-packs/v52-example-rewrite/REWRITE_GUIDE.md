# V5.2 例句重写规范（agent 必读）

v5.2 基础词库约 93% 的例句是模板框架生成的填充句（如 "We discussed ___ in today's tutorial"、"The article mentions ___ several times"），生硬且常与词义脱节。你的任务：对分配到的词，**重写全部例句**，使每条例句达到 v6 词库的自然度标准。

## 重写规则

1. **义项优先**：例句必须使用该词在当前 zhGloss/enDefinition 下的**真实核心义项**，禁止把抽象/专业义硬套进字面场景（反例：underwater 取"资不抵债"义却写 "The terms are underwater"）。
2. **义项错配修复**：若 collocations/enDefinition 指向的义项与 zhGloss 不一致（如 underwater：gloss="在水中的" 而搭配是 an underwater option/remain underwater 的金融义），以搭配指向的义项为准：修正 zhGloss 为该义项的标准中文译名（如 "资不抵债的"），enDefinition 一并对齐，再写例句。只在确实错配时才动 zhGloss/enDefinition。
3. **英文例句**：10–18 词，自然母语口吻（学生/同事/朋友/客服/医生等真实角色），必须包含 expression 或其自然屈折/变体。句式要贴合词条类别（accounting 词出现在对账/报表/审计场景，business 词出现在创业/采购/谈判场景，daily 词出现在生活场景）。
4. **中文例句**：忠实、通顺的现代中文翻译，不得逐词直译。用「」标注目标表达对应的中文译法（可按中文语序调整位置）。禁止错别字、禁止"的的"类重复、禁止生硬直译（如"条款是在水中的的"）。
5. **每词恰好 2 条例句**（en + zh 成对），两条场景/句式要有差异，不得同一模板换词。
6. **搭配不动**：collocations 保持原样，除非该词做了义项修复导致搭配与新义项冲突。
7. **不得改动**：id、senseKey、expression、lemma、partOfSpeech、source、priority、status、timestamps。zhGloss/enDefinition/acceptedZhAnswers 仅在规则 2 触发时修改（若改 zhGloss，acceptedZhAnswers 第一项要同步为新 zhGloss，可保留旧译作备选）。

## 全局禁用骨架

以下模板骨架（及任何"换一个词仍能成立"的同族句式）禁止出现。判断标准：**把目标词挖空后，这句话必须不再是一个可以套用到其他词上的通用框架**——句子要因为这个词的存在而不可替换。

已知的 161 个模板家族全部禁用，最高频的包括：
- "We discussed ___ in today's tutorial." / "The article mentions ___ several times." / "Please use ___ correctly in your essay." / "Can we explain ___ in one sentence?" / "We looked up ___ before the quiz."
- "Treasury settled the ___ yesterday." / "We need approval before booking the ___." / "Auditors sampled the ___ balance." / "The forecast includes the ___." / "Finance recalculated the ___."
- "The terms are ___, so we can still discuss price." / "We need a ___ option/alternative for this shipment." / "Before we sign, let's confirm the ___ in writing." / "The ops lead owns follow-up on the ___." / "Could you show me where to find the ___?" / "Once I understood the ___, ..." / "I sorted out the ___ on campus this afternoon." / "The lecturer asked us to bring the ___ to class."
- "Please ___ the delivery date in writing." / "We will ___ with the supplier tomorrow." / "We decided to ___ the risky option." / "We need to ___ before the deadline."

写完后自检：读你写的例句，问"这句话是不是只有用这个词才通？"——是，才算过关。

## 操作要求

- 工作文件是单行大 JSON：{"category": "...", "words": [...]}。用 node 脚本做精确字符串替换（先校验目标串唯一，写盘后 JSON.parse 校验），或整文件读入内存修改后重写。
- 处理完分配的所有文件后，对每个文件跑一次 JSON.parse 校验。
- 汇报：每个文件的词数、重写例句数、义项修复数（zhGloss 被改动的词条列表），以及 2–3 条你重写前后对比的示例。
