# english.lomivex.top 部署手册

本文供首次接手的管理员将邀请制 Lomi English（洛米英语） 部署到 Render + Supabase。按顺序完成后台配置、发布和两账号验收后，再邀请正式用户。当前仓库准备工作不代表网站已经发布；真实项目、SMTP、供应商权限和 DNS 仍需后台验证。本地 Docker daemon 不可用，数据库自动测试使用 PGlite，不能替代真实 Supabase 集成验收。

## 1. 准备账号和发布版本

需要可供 Render 读取的 Git 仓库、Render 账号、Singapore 地区的 Supabase 项目、`lomivex.top` DNS 管理权限、自定义 SMTP，以及 DeepSeek、百炼北京地域的可用凭证。当前使用免费 Web Service 试运行。凭证只填后台，不提交到 Git、聊天或截图。

在选定提交上运行：

```text
npm ci
npm run lint
npm test
npm run build
npm run cloud:seed -- --dry-run
```

记录提交 SHA 和验证结果，首次发布前确认仓库已包含这些修改。构建不要设置会省略 devDependencies 的安装选项，TypeScript / Vite 属于构建依赖。

## 2. 初始化 Supabase

1. 新建 Singapore 项目，妥善保存数据库密码。在 SQL Editor 执行 [数据库迁移](../supabase/migrations/202610230001_cloud.sql)，成功后确认表和 RPC 存在。迁移是一次性初始化，不要对已有生产库反复执行，也不要通过删表处理冲突。
2. 在项目 Connect / API Keys 页面取得项目 URL、publishable key 和 secret key。publishable key 用于浏览器；secret key 仅服务端管理使用。
3. 先执行 `npm run cloud:seed -- --dry-run`。正式导入时，从受控终端注入 `SUPABASE_URL`（或 `VITE_SUPABASE_URL`）和 `SUPABASE_SECRET_KEY`，再执行 `npm run cloud:seed`。免费实例没有 Render Shell，需要使用受控本机终端，或在 Supabase Table Editor 为 `words` 导入包含 `id,data` 两列的 CSV；上线验收前必须完成。不在命令行中写出密钥，工具不会自动读取 `.env.local`。
4. 比较 dry-run 和实际导入数量，在 SQL Editor 用 `select count(*) from public.words;` 检查结果。导入每批 200 条按 ID upsert，不删除历史共享词。中断时修复原因后可重跑。

表结构、RLS、CAS 同步和成员管理的详细约束见[数据库说明](../supabase/README.md)。

## 3. 配置 Auth 和邀请邮件

在 Authentication 中关闭新用户公开注册和匿名登录，保留邮箱密码登录。建议同时设置至少 12 字符的密码策略；前端也要求至少 12 字符。

在 URL Configuration 中配置：

| 项目 | 值 |
| --- | --- |
| Site URL | `https://english.lomivex.top` |
| Redirect URLs | `https://english.lomivex.top/auth/invite` |
| Redirect URLs | `https://english.lomivex.top/auth/update-password` |

只允许确定的正式回调，生产不要添加 `**` 或任意预览域名。[Supabase 回调配置](https://supabase.com/docs/guides/auth/redirect-urls)

在 SMTP 服务商先验证发信域名，根据其实际要求配置 SPF、DKIM 和 DMARC；不要覆盖已有邮箱 MX、SPF 记录。确认服务商验证成功后，在 Supabase Custom SMTP 填写发信地址、SMTP host、port、user、password，并实际测试投递。默认邮件服务仅供测试，不能承担普通受邀用户的正式邮件。[SMTP 官方说明](https://supabase.com/docs/guides/auth/auth-smtp)

网站域名和 TLS 就绪后再发邀请。在 Dashboard Users → Invite 中将 Redirect URL 设为 `https://english.lomivex.top/auth/invite`。若当前 Dashboard 邀请界面没有 Redirect URL 字段，发送前临时将 Site URL 改成这个完整邀请回调地址，发送后恢复根地址；确认收到的邮件目标落在 `/auth/invite`。受控管理程序也可调用 `auth.admin.inviteUserByEmail(email, { redirectTo: 'https://english.lomivex.top/auth/invite' })`，管理凭证仅留服务端。邮件模板保留默认 `ConfirmationURL` 确认链接，不直接链接网站跳过验证。[邀请 API](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail)

每次邀请后，在 SQL Editor 启用成员，将示例邮箱替换成实际受邀邮箱；确认返回或受影响记录为 1：

```sql
insert into public.app_memberships(user_id)
select id from auth.users where email = 'invited@example.com'
on conflict (user_id) do update set active = true;
```

用户打开邀请邮件设置密码后即可进入学习。设置密码成功但显示账号未启用时，检查成员记录，不能靠开放注册解决。忘记密码流程使用 `/auth/update-password`，也要实际收信和完成一次重置。

## 4. 创建 Render 服务

源码仓库为 [`SherlockMF/lomi-english-learning`](https://github.com/SherlockMF/lomi-english-learning)，统一使用 `master` 分支。仓库原名为 `recall-english`，Render 服务名仍保留 `recall-english`。已有服务在下次手动发布前，先核对 Settings 中的 GitHub 仓库和 Branch；如果仍绑定已删除的 `codex/render-supabase` 等分支，应切换到 `master`，并保持 Auto Deploy 关闭。修改仓库文件不会自动更新现有服务的后台绑定；更名本身不需要重建服务或数据库。

以仓库根目录的 [render.yaml](../render.yaml) 创建新的 Blueprint。核对名称不会匹配并更新已有同名服务。Blueprint 创建会执行首次部署，确认前先完成变量填写与数据库准备；后续自动发布已关闭，需要管理员手动 Deploy。不要在 Blueprint 中自动执行数据库迁移或导入。

| 设置 | 值 |
| --- | --- |
| Runtime / Region | Node / Singapore |
| Branch | `master` |
| Instance | Free，单实例试运行 |
| Node | `NODE_VERSION=22.x` |
| Build Command | `npm ci && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/healthz` |
| Auto Deploy | Off |

Blueprint 明确使用 `plan: free`，确认创建页面显示免费实例。工作区每月共享 750 个免费运行小时；空闲 15 分钟后会休眠，再次访问通常需要约 1 分钟唤醒。免费实例可能被重启，语音消息会话可能需要重新建立；学习数据保存在 Supabase。免费实例不支持 Shell、持久磁盘或多实例扩容。流量和构建另有额度，已绑定支付方式的工作区超额可能收费，创建前核对 Billing 的额度及可用费用限制。[免费实例官方说明](https://render.com/docs/free)

字段依据[官方 Blueprint 文档](https://render.com/docs/blueprint-spec)及[官方 JSON Schema](https://render.com/schema/render.yaml.json)；Node 版本按[官方配置方式](https://render.com/docs/node-version)固定。服务监听 `0.0.0.0`，端口读取 Render 的 `PORT`，无需手动设置。

在 Blueprint 初次创建时填写 `sync: false` 变量：

| 变量 | 用途与放置 |
| --- | --- |
| `VITE_SUPABASE_URL` | 项目 URL；构建和运行时都需要，可公开 |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | 浏览器公开 key；构建和运行时都需要 |
| `APP_ORIGIN` | 已设为 `https://english.lomivex.top`，无末尾斜杠 |
| `SUPABASE_SECRET_KEY` | 运行时服务端额度 RPC 管理凭证 |
| `DEEPSEEK_API_KEY` | 服务端 DeepSeek 凭证 |
| `DASHSCOPE_API_KEY` | 服务端百炼北京地域 Key |
| `DASHSCOPE_WORKSPACE_ID` | 对应北京地域业务空间 ID |

不要给服务端密钥添加 `VITE_` 前缀。Supabase 构建变量缺一会导致登录无法启动；两项都未设置会构建成本地版，因此生产必须填写完整。修改 `VITE_*` 后必须重新构建并发布，单纯重启无法更新浏览器包。SMTP 凭证放 Supabase Auth，不放前端。现有 Blueprint 后加 `sync: false` 变量不会自动提示填写，应在 Render Environment 手动补齐后发布。

此部署使用新制 Supabase secret key（`sb_secret_` 前缀）。服务端额度 RPC 仅在 `apikey` header 发送该 key，不把它当成 JWT 放进 `Authorization: Bearer`。用户身份请求则发送公开 publishable key 作为 `apikey`，并用用户真实 access token 作为 Bearer；两种凭证不能互换。[API key 官方说明](https://supabase.com/docs/guides/api/api-keys)

## 5. 域名与 TLS

在现有 Render 服务的 Custom Domains 添加 `english.lomivex.top`。在 `lomivex.top` 的 DNS 管理页添加 CNAME，主机记录为 `english`，记录值使用 Render 后台实际给出的服务域名（不含 `https://` 和路径）。先核对 `english` 是否已有冲突的 A / AAAA / CNAME，保留主域名、`www` 和邮件验证记录。完成 DNS Verify，等待 TLS 签发，再检查新域名的 HTTPS 和回调路径。[Render 域名说明](https://render.com/docs/custom-domains)

从主域名迁移时，按以下顺序切换：

1. 先添加新域名绑定和 DNS，确认新域名的 `/healthz` 返回 `{ "ok": true }`，TLS 无证书错误。
2. 在 Supabase 添加本手册第 3 节的新域名回调，迁移期间保留旧域名的精确回调，随后将 Site URL 改为 `https://english.lomivex.top`。
3. 在现有 Render 服务中将 `APP_ORIGIN` 改为 `https://english.lomivex.top`，发布已验证版本；仅修改本地 `render.yaml` 不代表后台变量或线上版本已更新。保留原服务名 `recall-english` 和现有数据库，避免创建第二套服务或丢失数据。
4. 验证新地址的登录、找回密码、API 和云同步后，主域名 `lomivex.top` 可单独部署其他网站。本项目不发布旧域名迁移页面或跳转。替换主域名网站前先导出尚未同步的本地学习数据；旧邀请或重置密码链接应在新地址重新申请。

原地址尚未同步的浏览器数据应先导出备份；新子域名无法读取旧域名的 IndexedDB / localStorage。云端账号数据继续使用原 Supabase 项目，重新登录后同步。迁移不更改数据库名、备份格式或内部存储标识。

若新旧两边都有独立进度，先分别导出，由管理员合并后再恢复，不直接用旧备份覆盖较新的云端数据。

本版本新增可选设置字段 `onboardingCompletedAt`、`learningGoal`，沿用现有 JSON 设置表，无需新数据库迁移。发布后提醒已有页面刷新；旧版客户端的严格校验不认识新字段，不应继续同时编辑设置。口语纠错复习复用已有 words/memberships/tracks，未新增录音或会话存储。

正式 API 只接受 `APP_ORIGIN`，不能从 `onrender.com` 地址完整验证登录后功能。`/healthz` 是公开健康检查，只返回 `{ "ok": true }`；健康正常不代表数据库、SMTP 或供应商已经可用。

## 6. 上线验收与旧数据迁移

2026-11-02 语音历史云同步发布：先执行增量迁移 `supabase/migrations/202611020001_voice_history.sql`，再部署应用。该迁移新增独立的历史、revision、清空幂等记录和私有 `voice-history` Storage bucket，不修改现有学习表或旧 RPC。确认 bucket 非公开、本人 active 成员 RLS、非本人和停用账号拒绝访问；录音通过 Storage API 上传/删除，不能直接删 `storage.objects` 元数据。服务端既有 secret key 仅用于清理已删除历史的文件，不进入浏览器。

账号打开后自动补传原本机历史；同步状态独立显示于顶部，失败保留队列并可重试。其他设备拉取文字及反馈，录音点击后下载。删除会传播持久墓碑，清理文件失败会重试；清空使用请求 UUID 防止重试删除后来新增的记录。没有设置自动过期，单音频上限 50 MiB；存储/流量超额或网络错误必须显示未完成，不能清空本地源记录。清除站点数据不会删除已成功同步的云历史；学习 JSON 备份仍不含语音历史和录音。

部署前的未保存内存对话无法追溯补传；已有 IndexedDB v5 记录可补传。若旧 v4 标签阻塞首次升级，应先下载旧页对话文字，再关闭旧标签重新打开，不能通过清除网站数据解决。数据库备份并不包含 Storage 文件，管理员恢复演练须另行包含对象存储。

使用两个独立受邀账号和全新浏览器上下文验证：

- 邀请、设置密码、登录、退出及找回密码；没有公开注册入口。
- A 修改词条并复习，另一设备登录 A 可同步；B 看不到 A 的私有词条和学习记录。离线修改恢复网络后可同步；冲突处理保留两边内容供选择。
- 未登录或停用账号不能访问 API、同步或读取云端私有数据。停用不会远程清除已经下载到该用户浏览器的本地缓存；已建立的直连 WebRTC 也无法靠停用立即断流。
- 查词、DeepSeek、实时畅聊和语音消息均用实际账户测试一次，检查供应商账单。不要只以配置状态判定调用成功。
- B 无法使用 A 的语音消息 session ID 发消息或结束会话；A 的原会话继续可用。发布或重启会丢失消息会话，提示重新开始。
- 配额耗尽返回 429，额度检查或供应商不可用明确失败；没有管理员密钥进入浏览器资源或错误信息。

旧 `localhost`、`127.0.0.1`、不同端口的数据互相独立，新域名无法读取。先在原地址导出学习备份，妥善保存，再登录正式站点的目标账号导入。备份恢复会替换当前账号数据并传播云同步，导入前另存当前账号备份，确认邮箱与文件归属；不要把他人的备份导入自己的账号。导入后比较词条、作答和复习进度，并在第二设备复核。不能通过清空浏览器缓存处理未同步数据。

## 7. 费用、会话与日志边界

默认每用户每日 DeepSeek 100 次、语音建连 30 次、语音消息 100 条，按 UTC 日期重置（日本时间 09:00）。建连额度由实时畅聊和消息会话共用；预约发生在请求供应商前，因此供应商失败仍可能消耗一次额度。语音同一消息 ID 重试不重复预约；新操作或重新建连会计入新请求。

生产消息模式每用户一个活跃会话，全服务最多 50 个，空闲 15 分钟清理。保持单实例：会话存在进程内存，多实例会导致后续请求找不到会话。扩容前需改造会话路由和状态。Render 重启、发布、网络中断后需要重新开始语音。实时 WebRTC 音频直连百炼，当前服务只能控制建连次数，不能强制按分钟断流；在供应商后台另设可用的预算提醒或额度。应用调用次数不是账单硬上限。

学习数据和 outbox 在账号隔离的 IndexedDB，云端由 RLS、active 成员和 CAS RPC 控制。所有 `/api/*` 使用真实 Supabase 用户校验及成员检查；生产凭证配置接口不可写。日志中不打印 Bearer token、环境值、邮件链接、完整学习内容或音频。当前应用只输出启动和通用配置失败信息；排查时在后台查看 HTTP 状态、Supabase Auth / 数据库及供应商错误，避免开启含请求正文的调试日志。平台仍可能保留访问元数据。

## 8. 备份、恢复与回滚

浏览器学习备份与 Supabase 数据库备份各自保留。浏览器备份不能恢复 Auth 用户、成员额度或全部服务状态。对 Supabase 按套餐确认数据库备份和保留期；免费项目不要假定有可恢复的自动备份，应按[官方备份说明](https://supabase.com/docs/guides/platform/backups)定期导出并保存到项目外的受控位置。建议每日一次、至少保留 7 天，另保留迁移 SQL 和发布提交；本变更没有创建定时任务。

首次邀请正式用户前，在隔离项目执行实际恢复演练：恢复数据库及所需 Auth 数据，核对用户 UUID、成员资格、共享词库、revision、墓碑和学习记录，运行两个账号隔离与同步测试，再记录恢复耗时和可接受的数据丢失窗口。后台恢复可能中断服务，先保存现状和未同步本地数据，再由管理员批准操作；不要在正在使用的生产库试验。云端恢复到旧 revision 后应要求客户端暂停同步，导出本地备份，再按恢复方案重建账号缓存，避免旧 outbox 覆盖恢复结果。不能随意删除 revision 或墓碑。

应用回滚通过 Render 选择此前已验证提交重新部署，确认与当前数据库兼容，完成健康与账号冒烟检查。应用回滚不会回滚数据库；数据库恢复按已演练方案单独执行。修改 DNS 或密钥前保留可回退配置，恢复后重新验证回调和供应商权限。

## 9. 常见故障

| 表现 | 检查顺序 |
| --- | --- |
| Render 启动失败 | Node 22、完整构建结果、4 项身份配置；错误不会输出密钥 |
| 能打开页面但没有云登录 | 构建时两项 `VITE_SUPABASE_*` 是否都存在，重新 build/deploy |
| API 401 | 登录是否过期，前端是否带当前账号 Bearer；不要使用服务端 Key 代替登录 |
| API 403 / 账号未启用 | 是否使用 `https://english.lomivex.top`、Origin 和 active 成员是否正确 |
| 同步失败 / 关联约束错误 | SQL 迁移、共享词库导入、账号、RLS；保留本地 outbox，先备份再排查 |
| 邮件不到或链接无效 | 自定义 SMTP、发信域名验证、垃圾邮件、回调白名单、过期/已使用邀请 |
| 429 | 账号当日调用额度或供应商限流；检查用量，不循环重试 |
| 503 / 语音不可用 | Supabase/额度 RPC、服务器密钥、百炼北京 workspace 和模型权限 |
| 语音消息 410 | 会话已结束、空闲清理、实例重启；重新建连，避免多实例 |
| HTTPS / DNS 未生效 | 后台要求的 DNS 目标、冲突记录、传播与 TLS 验证状态 |

发布完成记录提交 SHA、域名/TLS、邀请和重置邮件、两账号隔离、跨设备同步、供应商实际调用、备份恢复演练的结果。未完成的项目继续标记未验证。
