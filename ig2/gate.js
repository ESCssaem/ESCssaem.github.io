// 통합과학2 수업 자료 잠금 해제. 자료(d/*.bin)는 판마다 다른 열쇠로 암호화되어 있고,
// keys.json의 각 칸은 접속 코드로 그 판의 열쇠를 잠가 둔 것이다. 맞는 코드를 넣으면 그 판의 열쇠만 풀린다.
const GATE_KEY = "esc-ig2-key";
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const fresh = (u) => fetch(u, { cache: "no-cache" });

async function openSealed(key, buf) {
  const u8 = new Uint8Array(buf);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: u8.slice(0, 12) }, key, u8.slice(12));
}

// 코드 → {ed, k}. 틀리면 null
async function unlock(code) {
  const K = await (await fresh("keys.json")).json();
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(code.trim()), "PBKDF2", false, ["deriveKey"]);
  const kek = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: unb64(K.salt), iterations: K.iter, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  for (const s of K.slots) {
    try { return JSON.parse(new TextDecoder().decode(await openSealed(kek, unb64(s)))); } catch (_) {}
  }
  return null;
}

function savedKey() {
  for (const st of [sessionStorage, localStorage]) {
    try { const v = st.getItem(GATE_KEY); if (v) return JSON.parse(v); } catch (_) {}
  }
  return null;
}
function saveKey(v, remember) {
  try { (remember ? localStorage : sessionStorage).setItem(GATE_KEY, JSON.stringify(v)); } catch (_) {}
}
function forgetKey() {
  for (const st of [sessionStorage, localStorage]) { try { st.removeItem(GATE_KEY); } catch (_) {} }
}

// 수업 자료 하나를 받아 풀어 HTML 문자열로. onProgress(받은 바이트, 전체 바이트)
async function loadLesson(v, id, onProgress) {
  const r = await fresh(`d/${v.ed[0]}-${id}.bin`);
  if (!r.ok) throw new Error("자료 파일을 찾지 못했습니다 (" + r.status + ")");
  const total = +r.headers.get("content-length") || 0;
  const reader = r.body.getReader(), parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.length; onProgress && onProgress(got, total);
  }
  const buf = new Uint8Array(got); let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  const key = await crypto.subtle.importKey("raw", unb64(v.k), "AES-GCM", false, ["decrypt"]);
  const gz = await openSealed(key, buf);
  const plain = new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip")));
  return plain.text();
}
