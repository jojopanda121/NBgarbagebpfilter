-- 071_forum_attachments.sql
-- 论坛帖子 / 评论的附件（图片 + 文档）。
--
-- 存储形态：附件元数据以 JSON 数组直接挂在帖/评论行上（attachments 列），
--   不另建关联表 —— 附件天然从属于一条帖/评论，随其级联删除，查询也无需 JOIN。
--   每个元素：{ url, kind, name, mime, size }
--     url   = /uploads/forum/...（服务端落盘后的可访问路径，仅本站上传产物）
--     kind  = 'image' | 'file'
--     name  = 原始文件名（仅展示用，已做长度/路径清洗）
--     mime  = 上传时的 MIME（仅展示/下载提示用）
--     size  = 字节数
--
-- 产品约束（在 service 层强制，不在 DB 层）：
--   帖子：最多 9 张图 + 3 个文档；评论：最多 1 张图。
--   单文件大小：图片 ≤ 5MB，文档 ≤ 20MB（multer + 控制器双重把关）。
--
-- 隐私：附件仅对登录用户与作者可见；游客软墙 / 无 JS 爬虫的 SEO 视图都不暴露附件，
--   与「正文截断、不返回联系方式」保持一致（脱敏仍由发帖人把关 + 服务端兜底）。

ALTER TABLE forum_posts    ADD COLUMN attachments TEXT;   -- JSON [{url,kind,name,mime,size}]，可空
ALTER TABLE forum_comments ADD COLUMN attachments TEXT;   -- JSON（评论限 1 张图），可空
