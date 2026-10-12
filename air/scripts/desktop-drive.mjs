// Manual test aid, not part of the product: drives a running desktop app through its renderer debugging port.
// Start the app with DSH_DESKTOP_RENDERER_DEBUG_PORT set; this script reads AIR_DESKTOP_DEBUG_PORT (default 9222).
// Usage: node air/scripts/desktop-drive.mjs <cmd> [args]
// Commands: title | text [n] | find <s> | candidates | send <text> | wait <s> [sec] [minCount] | click <text> | clickaria <label>
const PORT = Number(process.env.AIR_DESKTOP_DEBUG_PORT ?? 9222);
const [, , cmd, ...args] = process.argv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const COMPOSER_SEL = 'textarea, [contenteditable="true"], [role="textbox"]';
const COMPOSER_RE = /Describe what you want|Message or run a task/;
// Returns the first visible composer whose placeholder, aria-label or data-placeholder matches COMPOSER_RE.
const FIND_COMPOSER = `(() => {
  const re = ${COMPOSER_RE.toString()};
  return Array.from(document.querySelectorAll(${JSON.stringify(COMPOSER_SEL)})).find((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const s = [el.placeholder, el.getAttribute('aria-label'), el.getAttribute('data-placeholder')].join(' ');
    return re.test(s);
  }) || null;
})()`;

async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = list.find((p) => p.type === 'page' && p.url.startsWith('dsh-app://'));
  if (!page) throw new Error('no dsh-app:// page on port ' + PORT);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('websocket error')); });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => {
    const m = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (m.error) throw new Error(JSON.stringify(m.error));
    if (m.result.exceptionDetails) throw new Error('eval: ' + (m.result.exceptionDetails.exception?.description || m.result.exceptionDetails.text));
    return m.result.result.value;
  };
  return { ws, send, evaluate };
}

const bodyText = `document.body.innerText`;
const composerText = `(() => { const el = ${FIND_COMPOSER}; return el ? (el.value ?? el.innerText ?? el.textContent ?? '') : null; })()`;

async function pressEnter(send) {
  const base = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', text: '\r', ...base });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

async function main() {
  const c = await connect();
  try {
    switch (cmd) {
      case 'title': return { title: await c.evaluate('document.title') };
      case 'text': {
        const n = Number(args[0] ?? 600);
        const t = await c.evaluate(bodyText);
        return { chars: t.length, text: t.slice(-n) };
      }
      case 'find': {
        const s = args[0];
        const t = await c.evaluate(bodyText);
        const idx = t.lastIndexOf(s);
        const count = t.split(s).length - 1;
        return { found: count > 0, count, around: idx >= 0 ? t.slice(Math.max(0, idx - 100), idx + s.length + 100) : null };
      }
      case 'candidates': {
        return await c.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(COMPOSER_SEL + ', button, [role="button"]')})).slice(0, 10).map((el) => ({ tag: el.tagName, role: el.getAttribute('role'), placeholder: el.placeholder || null, aria: el.getAttribute('aria-label'), dataPh: el.getAttribute('data-placeholder'), text: (el.innerText || '').trim().slice(0, 40) }))`);
      }
      case 'send': {
        const text = args.join(' ');
        const focused = await c.evaluate(`(() => { const el = ${FIND_COMPOSER}; if (!el) return false; el.focus(); return true; })()`);
        if (!focused) return { sent: false, error: 'composer not found' };
        await c.send('Input.insertText', { text });
        await sleep(500);
        await pressEnter(c.send);
        let extraEnter = false;
        if (text.startsWith('/')) {
          await sleep(1500);
          const still = await c.evaluate(composerText);
          if (still && still.includes(text)) { await pressEnter(c.send); extraEnter = true; }
        }
        return { sent: true, slashExtraEnter: extraEnter };
      }
      case 'wait': {
        const s = args[0];
        const timeout = Number(args[1] ?? 180);
        const minCount = Number(args[2] ?? 1);
        const start = Date.now();
        let found = false;
        while (true) {
          const t = await c.evaluate(bodyText);
          const count = t.split(s).length - 1;
          if (count >= minCount) { found = true; break; }
          if ((Date.now() - start) / 1000 >= timeout) break;
          await sleep(2000);
        }
        return { found, elapsedSec: Math.round((Date.now() - start) / 100) / 10, timeoutSec: timeout, minCount };
      }
      case 'click': {
        const label = args.join(' ');
        const box = await c.evaluate(`(() => {
          const el = Array.from(document.querySelectorAll('button, [role="button"]')).find((b) => {
            const r = b.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && (b.innerText || '').trim() === ${JSON.stringify(label)};
          });
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        })()`);
        if (!box) return { clicked: false, found: false };
        const pt = { x: box.x, y: box.y, button: 'left', clickCount: 1 };
        await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...pt });
        await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...pt });
        return { clicked: true, found: true };
      }
      case 'clickaria': {
        const needle = args.join(' ').toLowerCase();
        const hit = await c.evaluate(`(() => {
          const needle = ${JSON.stringify(needle)};
          const el = Array.from(document.querySelectorAll('button, [role="button"], [role="tab"], a')).find((b) => {
            const r = b.getBoundingClientRect();
            if (!(r.width > 0 && r.height > 0)) return false;
            const a = (b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '');
            return a.toLowerCase().includes(needle);
          });
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim() };
        })()`);
        if (!hit) return { clicked: false, found: false };
        const pt = { x: hit.x, y: hit.y, button: 'left', clickCount: 1 };
        await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...pt });
        await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...pt });
        return { clicked: true, found: true, label: hit.label };
      }
      default:
        return { error: 'usage: title | text [n] | find <s> | candidates | send <text> | wait <s> [sec] [minCount] | click <text> | clickaria <label>' };
    }
  } finally {
    c.ws.close();
  }
}

main().then((r) => { console.log(JSON.stringify(r)); process.exit(0); })
  .catch((e) => { console.log(JSON.stringify({ error: String(e.message || e) })); process.exit(1); });
