import { DurableObject } from "cloudflare:workers";

const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>共享网盘</title>
<style>
  html, body { height: 100%; margin: 0; }
  body { display: flex; background: #fff; overflow: hidden; }
  textarea {
    flex: 1; width: 100%; height: 100%;
    border: 0; outline: none; resize: none;
    padding: 16px; box-sizing: border-box;
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI",
          "PingFang SC", "Microsoft YaHei", sans-serif;
    -webkit-appearance: none; background: transparent; color: #111;
  }
  #status {
    position: fixed; right: 12px; bottom: 8px;
    font-size: 12px; color: #bbb;
    pointer-events: none; user-select: none;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
  }
</style>
</head>
<body>
<textarea id="box" placeholder="在这里输入，所有设备同步…" spellcheck="false"></textarea>
<div id="status">连接中…</div>
<script>
const box = document.getElementById('box');
const status = document.getElementById('status');
let ws = null, reconnectTimer = null, statusTimer = null;

function setStatus(txt, keep) {
  status.textContent = txt;
  clearTimeout(statusTimer);
  if (!keep) {
    statusTimer = setTimeout(() => { status.textContent = '已连接'; }, 1200);
  }
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(proto + '//' + location.host + '/ws');

  ws.onopen = () => setStatus('已连接', true);

  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (_) { return; }

    if (msg.type === 'init') {
      box.value = msg.text;
    } else if (msg.type === 'update') {
      if (box.value === msg.text) return;
      const focused = document.activeElement === box;
      const s = box.selectionStart, en = box.selectionEnd;
      box.value = msg.text;
      if (focused) {
        const len = msg.text.length;
        box.setSelectionRange(Math.min(s, len), Math.min(en, len));
      }
      setStatus('已同步');
    }
  };

  ws.onclose = () => {
    setStatus('已断开，重连中…', true);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 1000);
  };

  ws.onerror = () => { try { ws.close(); } catch (_) {} };
}

box.addEventListener('input', () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'update', text: box.value }));
    setStatus('同步中…');
  }
});

connect();
</script>
</body>
</html>`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname !== '/ws') {
      return new Response(HTML, {
        headers: { 'Content-Type': 'text/html;charset=UTF-8' },
      });
    }

    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }

    const id = env.TEXT_SYNC.idFromName('global');
    const stub = env.TEXT_SYNC.get(id);
    return stub.fetch(request);
  },
};

export class TextSync extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.getWebSockets().forEach((ws) => {
      const attachment = ws.deserializeAttachment();
      if (attachment) {
        this.sessions.set(ws, attachment);
      }
    });
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('ping', 'pong')
    );
  }

  sessions = new Map();

  async fetch(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);

    const id = crypto.randomUUID();
    server.serializeAttachment({ id });
    this.sessions.set(server, { id });

    const text = (await this.ctx.storage.get('text')) || '';
    server.send(JSON.stringify({ type: 'init', text }));

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    let msg;
    try { msg = JSON.parse(message); } catch (_) { return; }

    if (msg.type === 'update') {
      await this.ctx.storage.put('text', msg.text);

      const data = JSON.stringify({ type: 'update', text: msg.text });
      this.ctx.getWebSockets().forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          try { client.send(data); } catch (_) {}
        }
      });
    }
  }

  async webSocketClose(ws, code, reason, wasClean) {
    this.sessions.delete(ws);
    ws.close(code, 'Durable Object is closing WebSocket');
  }

  async webSocketError(ws, error) {
    this.sessions.delete(ws);
    try { ws.close(1011, 'WebSocket error'); } catch (_) {}
  }
}
