# Expansion V6 生成规范（agent 必读）

面向海外大学生（中文释义）的词库扩充。本文件是所有生成与校核 agent 的唯一规范来源。

## 目标用户

中文母语、在英语国家就读大学的学生。场景覆盖：校园学术、住宿生活、医疗健康、个人金融、求职职场、餐饮、交通、政务证件、应急安全、购物、社交文化、娱乐运动、数字生活、沟通表达，以及专业选修。

## chunk 文件格式

路径：`data/vocabulary-packs/expansion-v6/chunks/<category>-<seq>-<slug>.json`
（seq 为两位序号，slug 为子主题短横线名，例如 `campus-01-course-registration.json`）

```json
{
  "category": "campus",
  "subcategory": "course-registration",
  "words": [ ...词对象... ]
}
```

- `category`：词单 slug（见下方分类表）
- `subcategory`：本 chunk 的子主题（英文短横线小写），会写到每条 membership 上
- `words`：词对象数组，**紧凑 JSON（不缩进）**

## 词对象字段（全部必填，除非标注可选）

```json
{
  "id": "v6-campus-enrollment-3f9a21c4",
  "expression": "course enrollment",
  "lemma": "course enrollment",
  "senseKey": "v6:campus-3f9a21c4",
  "zhGloss": "选课注册",
  "enDefinition": "the process of registering for courses each term",
  "partOfSpeech": "noun phrase",
  "acceptedZhAnswers": ["选课注册", "课程注册"],
  "acceptedEnVariants": ["course enrollment", "enrollment"],
  "examples": [
    { "en": "Course enrollment opens next Monday, so plan your schedule early.", "zh": "选课注册下周一开放，所以尽早规划课表。" },
    { "en": "The advisor helped me fix a conflict during course enrollment.", "zh": "导师帮我在选课注册时解决了时间冲突。" }
  ],
  "collocations": ["complete course enrollment", "course enrollment period", "drop a course during enrollment"],
  "source": "seed",
  "priority": 7,
  "status": "active",
  "usagePrompts": [],
  "vocabularyLevel": "B1",
  "createdAt": "2026-11-20T00:00:00.000Z",
  "updatedAt": "2026-11-20T00:00:00.000Z"
}
```

### 字段细则

- **id**：`v6-<category>-<slug>-<8位十六进制>`。slug 取 expression 的短横线小写（去标点）。8 位 hex 在本 chunk 内唯一即可（随机生成）。
- **expression**：目标词条。小写开头（除非专有名词/缩写如 IFRS、GPA）。
- **lemma**：expression 的 trim + 小写（en-US）。
- **senseKey**：`v6:<category>-<同一个8位hex>`，与 id 的 hex 一致。
- **zhGloss**：简体中文释义，**一个核心义项**，不带词性前缀（不得以 n. / v. / adj. 等开头）。大陆简体常用词。长度一般 ≤ 12 字。
- **enDefinition**：英文简明定义，8 词左右，不重复抄 expression 本身。
- **partOfSpeech**：`noun` / `noun phrase` / `verb` / `verb phrase` / `adjective` / `adverb` / `phrase` / `sentence` / `phrasal verb` 等小写。
- **acceptedZhAnswers**：1–3 个可接受中文答案，**第一个必须等于 zhGloss**。
- **acceptedEnVariants**：1–3 个英文变体，第一个必须等于 expression。
- **examples**：**恰好 2 条**。每条 en 是自然完整的英文句子（10–18 词），必须包含 expression 或其变体；zh 是对应自然中文翻译，**用「」包住目标表达**（译名不必逐字等于 zhGloss，可按句内语序调整）。例句要贴合该分类的真实场景（选课、租房、看病…），避免生造腔调。
- **collocations**：**恰好 3 条**。真实高频搭配（动词+名词、形+名等），不含中文。
- **vocabularyLevel**（可选）：`A1`–`C2`。有把握才写；专业词或拿不准就省略字段。
- **source** 固定 `"seed"`；**priority** 按分类表；**status** `"active"`；**usagePrompts** 固定 `[]`；createdAt/updatedAt 固定 `"2026-11-20T00:00:00.000Z"`。

## 分类与规模（批次1）

| category | 词单 | priority | 目标词数 | 子主题拆分建议 |
|---|---|---|---|---|
| daily | Daily Life | 8 | 2000 | 核心动词、家庭与人、情感状态、家务起居、时间天气、地点场所、数量程度、日常功能句 |
| campus | Campus & Academic | 7 | 2000 | 选课注册、课堂教学、作业考试、学术写作引用、学位学籍、图书馆资源、校园机构人员、学生服务社团 |
| housing | Housing & Living | 7 | 1200 | 租房流程、租约押金、水电网账单、家具家电、家务起居、搬家邻里 |
| health | Health & Medical | 7 | 1200 | 症状疾病、诊疗流程、药品药房、保险理赔、心理健康、牙科眼科 |
| money | Money & Banking | 7 | 1000 | 银行开户、支付转账、预算消费、税务信用 |
| career | Career & Employment | 7 | 1500 | 求职搜索、简历材料、面试、职场沟通、实习、工签移民 |

## 硬性质量要求

1. **不与其他词重复**：同一 chunk 内不得有相同 expression+POS；跨 chunk 的重复由校验脚本警告，复核 agent 负责删除。与现有 7361 词库的重叠也由校验警告处理——生成时尽量避开明显的基础重叠词（如已有 academic transcript 这类）。
2. **语义准确**：zhGloss 必须是该 expression 在本分类场景下的核心义项；一个英文词的多个常用义项可以分属不同分类（如 deposit 在 money=存款、housing=押金），但 senseKey/id 必须不同。
3. **例句自然**：像母语者说话/写邮件，不要翻译腔；不要在例句里堆砌生僻词；中文翻译地道，不逐词直译。
4. **面向学生**：例句主角是学生、室友、教授、房东、医生、HR，不是大企业高管。
5. **敏感内容**：避免暴力、色情、政治敏感；医疗类只做语言学习定位。
6. **每个词都要自成一个义项**：不要把多义词塞进一个词条（zhGloss 里用「；」罗列多个义项是不允许的）。

## chunk 大小

每个 chunk 目标 **125 个词**（±10%）。一个 agent 产出一个 chunk 文件。
