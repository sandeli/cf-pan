# 🔐 双人共享文本

基于 Cloudflare Workers + Durable Object 的实时双栏文本同步工具。打开网页输入密码后，左右两个面板，双方各写各的、互相实时可见。适合两人远程协作、对照核对、一问一答。

Fork 自 [yyc25253/cf-pan](https://github.com/yyc25253/cf-pan)，增加了密码保护、房间隔离、输入防抖，并改为双栏模式。

## 功能

- **双栏同步**：左右两个独立面板，各写各的，实时互见；左侧淡蓝底 💠、右侧淡绿底 🍀；手机上自动上下排列
- **密码保护**：设置 `PASSWORD` 后访问需要密码 🔐（未设置则公开访问）；同标签页内记住密码，刷新自动登录
- **房间隔离**：登录框填写房间号，不填为默认房间；也支持 URL 参数 `?room=名称`（URL 指定时登录框不再显示房间输入）；房间号会记住，下次自动填入
- **身份标识**：`?side=left` 或 `?side=right` 标记自己是哪一边（默认 left），页面上会显示"（我）"
- **输入防抖**：300ms，停止输入后才同步，减少无效传输
- **24 小时自动清空**：每次输入后重置倒计时，最后一笔输入满 24 小时后后台自动清空房间数据；24 小时内随时进入房间可查看
- **断线重连**：WebSocket 断线自动重连，同步时保持光标位置
- 内容持久化在 Durable Object 存储中（每边上限 512KB）

## 部署

### GitHub Actions 自动部署（推荐）

1. Fork 本仓库
2. 在 Cloudflare 创建 API Token（权限：Workers 相关），加到 GitHub 仓库的 Secrets：`CLOUDFLARE_API_TOKEN`
3. 推送到 `main` 分支自动部署；也可在 Actions 页面手动触发

### 本地 Wrangler 部署

```bash
npm install -g wrangler
wrangler login
wrangler deploy
```

### 设置密码（可选但强烈建议）

```bash
wrangler secret put PASSWORD
```

或在 Cloudflare Dashboard → Worker → Settings → Variables and Secrets 中添加 `PASSWORD`（记得勾选 Secret）。

不设置密码时任何人打开链接都能读写。

## 使用

- 默认房间：`https://<你的域名>/` → 登录框填密码，房间号留空
- 指定房间：登录框填密码 + 房间号，或直接访问 `https://<你的域名>/?room=abc123`
- 标识身份：`https://<你的域名>/?room=abc123&side=right`
- 密码和房间号保存在浏览器 sessionStorage，关闭标签页后清除

## 注意事项

- 房间名仅支持小写字母、数字、`-`、`_`，最长 64 字符
- 房间数据在最后一笔输入 24 小时后自动清除，重要内容请自行备份
