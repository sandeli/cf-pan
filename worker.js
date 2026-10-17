import { DurableObject } from "cloudflare:workers";

const DEBOUNCE_MS = 300;
const MAX_ROOM_LEN = 64;
const MAX_TEXT_LEN = 512 * 1024; // 512KB per side

function sanitizeRoom(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(s)) return "default";
  return s.slice(0, MAX_ROOM_LEN);
}

async function constantTimeEqual(a, b) {
  const enc = new TextEncoder();
  const ab = enc.encode(a), bb = enc.encode(b);
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>双人共享文本</title>
<style>
  html, body { height: 100%; margin: 0; }
  body { background: #fff; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
  #panels { display: flex; height: 100%; }
  .panel { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .panel + .panel { border-left: 1px solid #eee; }
  .label {
    padding: 10px 16px; font-size: 13px; color: #999;
    border-bottom: 1px solid #f0f0f0; user-select: none;
    display: flex; justify-content: space-between; align-items: center;
  }
  .label .who { color: #bbb; font-size: 12px; }
  textarea {
    flex: 1; width: 100%; border: 0; outline: none; resize: none;
    padding: 16px; box-sizing: border-box;
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI",
          "PingFang SC", "Microsoft YaHei", sans-serif;
    -webkit-appearance: none; background: transparent; color: #111;
  }
  @media (max-width: 640px) {
    #panels { flex-direction: column; }
    .panel + .panel { border-left: 0; border-top: 1px solid #eee; }
  }
  #status {
    position: fixed; right: 12px; bottom: 8px;
    font-size: 12px; color: #bbb;
    pointer-events: none; user-select: none;
  }
  #auth {
    position: fixed; inset: 0; background: rgba(255,255,255,.97);
    display: flex; align-items: center; justify-content: center;
    z-index: 10;
  }
  #authBox { text-align: center; }
  #authBox input {
    font-size: 16px; padding: 10px 14px; border: 1px solid #ddd;
    border-radius: 8px; outline: none; width: 220px;
  }
  #authBox button {
    font-size: 16px; padding: 10px 20px; margin-left: 8px;
    border: 0; border-radius: 8px; background: #111; color: #fff;
    cursor: pointer;
  }
  #authErr { color: #c00; font-size: 13px; margin-top: 8px; min-height: 18px; }
  #room { position: fixed; left: 12px; bottom: 8px; font-size: 12px; color: #ccc;
    pointer-events: none; user-select: none; }
</style>
</head>
<body>
<div id="panels">
  <div class="panel">
    <div class="label"><span>左侧</span><span class="who" id="whoL"></span></div>
    <textarea id="boxL" placeholder="左侧输入…" spellcheck="false"></textarea>
  </div>
  <div class="panel">
    <div class="label"><span>右侧</span><span class="who" id="whoR"></span></div>
    <textarea id="boxR" placeholder="右侧输入…" spellcheck="false"></textarea>
  </div>
</div>
<div id="room"></div>
<div id="status">连接中…</div>
<div id="auth" style="display:none">
  <div id="authBox">
    <input id="pwd" type="password" placeholder="输入访问密码" autocomplete="off">
    <button id="go">进入</button>
    <div id="authErr"></div>
  </div>
</div>
<script>
const boxL = document.getElementById('boxL');
const boxR = document.getElementById('boxR');
const status = document.getElementById('status');
const authDiv = document.getElementById('auth');
const pwdInput = document.getElementById('pwd');
const authErr = document.getElementById('authErr');
const roomDiv = document.getElementById('room');

const boxes = { left: boxL, right: boxR };
const timers = { left: null, right: null };

const params = new URLSearchParams(location.search);
const room = (params.get('room') || 'default').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64) || 'default';
roomDiv.textContent = room === 'default' ? '' : ('房间: ' + room);

// 我是哪一边： ?side=left|right，不指定则默认为 left
const mySide = params.get('side') === 'right' ? 'right' : 'left';
document.getElementById(mySide === 'left' ? 'whoL' : 'whoR').textContent = '（我）';

let ws = null, reconnectTimer = null, statusTimer = null;
let authed = false, needAuth = false;
let password = sessionStorage.getItem('pan_pwd') || '';

function setStatus(txt, keep) {
  status.textContent = txt;
  clearTimeout(statusTimer);
  if (!keep) {
    statusTimer = setTimeout(() => { status.textContent = authed ? '已连接' : status.textContent; }, 1200);
  }
}

function applyUpdate(side, text) {
  const box = boxes[side];
  if (!box || box.value === text) return;
  const focused = document.activeElement === box;
  const s = box.selectionStart, en = box.selectionEnd;
  box.value = text;
  if (focused) {
    const len = text.length;
    box.setSelectionRange(Math.min(s, len), Math.min(en, len));
  }
}

function showAuth(msg) {
  authDiv.style.display = 'flex';
  if (msg) authErr.textContent = msg;
  pwdInput.focus();
}
function hideAuth() {
  authDiv.style.display = 'none';
  authErr.textContent = '';
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(proto + '//' + location.host + '/ws?room=' + encodeURIComponent(room));

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'auth', password }));
  };

  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (_) { return; }

    if (msg.type === 'auth_ok') {
      authed = true; needAuth = false;
      hideAuth();
      setStatus('已连接', true);
      return;
    }
    if (msg.type === 'auth_required') {
      needAuth = true; authed = false;
      showAuth();
      setStatus('需要密码', true);
      return;
    }
    if (msg.type === 'auth_fail') {
      needAuth = true; authed = false;
      password = '';
      sessionStorage.removeItem('pan_pwd');
      showAuth('密码错误，请重试');
      setStatus('密码错误', true);
      try { ws.close(); } catch (_) {}
      return;
    }
    if (!authed) return;

    if (msg.type === 'init') {
      applyUpdate('left', msg.left || '');
      applyUpdate('right', msg.right || '');
    } else if (msg.type === 'update') {
      applyUpdate(msg.side, msg.text || '');
      setStatus('已同步');
    }
  };

  ws.onclose = () => {
    authed = false;
    if (!needAuth) setStatus('已断开，重连中…', true);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 1000);
  };

  ws.onerror = () => { try { ws.close(); } catch (_) {} };
}

function doAuth() {
  password = pwdInput.value;
  sessionStorage.setItem('pan_pwd', password);
  hideAuth();
  try { ws.close(); } catch (_) {}
  connect();
}
document.getElementById('go').addEventListener('click', doAuth);
pwdInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth(); });

// 每一边独立防抖、独立同步；只发送自己这一边的内容
// （也可以编辑对方那一栏，会同样同步过去）
for (const side of ['left', 'right']) {
  boxes[side].addEventListener('input', () => {
    if (!authed || !ws || ws.readyState !== WebSocket.OPEN) return;
    clearTimeout(timers[side]);
    setStatus('同步中…');
    timers[side] = setTimeout(() => {
      ws.send(JSON.stringify({ type: 'update', side, text: boxes[side].value }));
    }, ${DEBOUNCE_MS});
  });
}

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

    const room = sanitizeRoom(url.searchParams.get('room'));
    const id = env.TEXT_SYNC.idFromName('room:' + room);
    const stub = env.TEXT_SYNC.get(id);
    return stub.fetch(request);
  },
};

const SIDES = ['left', 'right'];

export class TextSync extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
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

  async getTexts() {
    const left = (await this.ctx.storage.get('text:left')) || '';
    const right = (await this.ctx.storage.get('text:right')) || '';
    return { left, right };
  }

  async fetch(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);

    const id = crypto.randomUUID();
    server.serializeAttachment({ id });
    this.sessions.set(server, { id, authed: false });

    if (!this.env.PASSWORD) {
      const session = this.sessions.get(server);
      session.authed = true;
      const { left, right } = await this.getTexts();
      server.send(JSON.stringify({ type: 'auth_ok' }));
      server.send(JSON.stringify({ type: 'init', left, right }));
    } else {
      server.send(JSON.stringify({ type: 'auth_required' }));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    let msg;
    try { msg = JSON.parse(message); } catch (_) { return; }
    const session = this.sessions.get(ws);
    if (!session) return;

    if (!session.authed) {
      if (msg.type === 'auth' && typeof msg.password === 'string') {
        const ok = await constantTimeEqual(msg.password, this.env.PASSWORD || '');
        if (ok && this.env.PASSWORD) {
          session.authed = true;
          const { left, right } = await this.getTexts();
          ws.send(JSON.stringify({ type: 'auth_ok' }));
          ws.send(JSON.stringify({ type: 'init', left, right }));
        } else {
          try { ws.send(JSON.stringify({ type: 'auth_fail' })); } catch (_) {}
          try { ws.close(4401, 'Unauthorized'); } catch (_) {}
        }
      }
      return;
    }

    if (msg.type === 'update' && SIDES.includes(msg.side) && typeof msg.text === 'string') {
      const text = msg.text.slice(0, MAX_TEXT_LEN);
      await this.ctx.storage.put('text:' + msg.side, text);

      const data = JSON.stringify({ type: 'update', side: msg.side, text });
      this.ctx.getWebSockets().forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          const s = this.sessions.get(client);
          if (s && s.authed) {
            try { client.send(data); } catch (_) {}
          }
        }
      });
    }
  }

  async webSocketClose(ws, code, reason, wasClean) {
    this.sessions.delete(ws);
    try { ws.close(code, 'Durable Object is closing WebSocket'); } catch (_) {}
  }

  async webSocketError(ws, error) {
    this.sessions.delete(ws);
    try { ws.close(1011, 'WebSocket error'); } catch (_) {}
  }
}
