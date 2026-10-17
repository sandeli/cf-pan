# 共享文本同步

基于 Cloudflare Workers + Durable Object 的实时文本同步工具。打开网页，多设备共享同一份文本，一端输入、各端实时同步。适合手机电脑互传文字、临时分享文本片段。

Fork 自 [yyc25253/cf-pan](https://github.com/yyc25253/cf-pan)，增加了密码保护、房间隔离和输入防抖。

## 功能

- 实时同步：WebSocket 全双工，一端输入、各端即时更新
- 密码保护：设置 `PASSWORD` 后访问需要密码（未设置则公开访问）
- 房间隔离：`?room=名称` 不同房间文本互不干扰，不填则为默认房间
- 输入防抖：300ms，文本框停止输入后才同步，减少无效传输
- 断线重连、同步时保持光标位置
- 文本持久化在 Durable Object 存储中（单房间上限 512KB）

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

或在 Cloudflare Dashboard → Worker → Settings → Variables and Secrets 中添加 `PASSWORD`。

不设置密码时任何人打开链接都能读写。

## 使用

- 默认房间：`https://<你的域名>/`
- 指定房间：`https://<你的域名>/?room=abc123`
- 密码保存在浏览器 sessionStorage，关闭标签页后清除
