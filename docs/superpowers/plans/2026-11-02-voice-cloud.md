# 语音历史云同步

用户授权：全部历史同步云端，延续本轮推送部署。文字、反馈与会话信息存 Supabase 数据库，已有语音消息 Blob 存私有 Storage；实时模式仍无录音。不新增支付、分析或其他数据采集。

架构：独立 voice_history / voice_history_revisions 与 RPC，避免修改学习同步协议和让音频阻塞词库同步。本地沿用 IndexedDB v5，cloudMeta 保存持久化待传队列、拉取游标和服务端版本；旧记录首次自动排队。队列写入与历史修改同一事务。跨设备下拉文字，播放时鉴权下载音频。账号切换取消旧任务。删除为持久墓碑，旧写入不可复活；服务器用 Storage API 清理已删除记录的文件，失败继续重试。

接口：voice_history_prepare / voice_history_apply（逐记录 CAS）/ voice_history_pull（最多 100 条，revision 游标）/ voice_history_clear。音频路径为 user UUID / history UUID / content SHA256.wav，只允许本人且 active 成员访问。POST /api/voice-history/cleanup 只处理认证账号的墓碑，不接受用户指定账号或对象路径，返回 cleaned / remaining；延续现有身份、Origin、错误响应。上传单文件上限 50 MiB，失败保留本机记录并显示重试，不假报已同步。

本次不自动过期云历史，不将音频塞入 JSON 学习备份。清空历史会在联网后清空云端及已同步设备历史，后续新会话独立排队；其他离线设备将在联网后收敛。清除浏览器缓存不会删除已同步云历史。

- [x] SQL 与 RLS：先写 PGlite 测试，验证账号隔离、停用拒绝、CAS、分页、删除优先、Storage 私有路径；新增增量迁移，不改旧迁移。
- [x] 本地队列与同步：先写 Vitest 测试，覆盖旧记录补传、失败重试、音频序列化、并发保存、删除防复活及账号切换。实现 historyCloudStorage / historyCloud / historyTransport。
- [x] UI 与服务：CloudApp 启动独立同步并显示状态；历史详情按需下载音频，更新同步/删除/数据说明；新增安全清理端点及测试。
- [ ] 验证与发布：相关测试、全量单进程测试、build、lint、E2E；先应用增量 SQL，再推送部署指定提交，验证云端权限和线上资源。保留所有原用户数据与临时文件。

参考：Supabase Storage RLS https://supabase.com/docs/guides/storage/security/access-control ，物理删除必须用 Storage API https://supabase.com/docs/reference/javascript/storage-from-remove 。

部署前检查：2026-11-02 已在既有 Supabase 项目执行增量 SQL，界面返回 Success. No rows returned。查询确认三张表 RLS 开启、录音桶私有、两条 Storage 策略存在、anon 无 RPC 执行权限。相关 20 项测试及随后 UI/API 24 项测试通过，构建、lint 与 diff 检查通过（lint 有既有告警及分页测试顺序执行提示）。未连接真实麦克风或收费模型。

完整验证：npm test -- --maxWorkers=1：83 个文件、600 项通过；npm run test:e2e：5 项通过；npm run build、npm run lint、git diff --check 通过。生产 storage.objects 仅存在本次两条按 active 成员及本人历史路径限制的策略，无其他宽松策略。应用推送与 Render 指定提交发布随后执行。
