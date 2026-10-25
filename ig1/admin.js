// 접속 코드 관리(관리자 교사판에서만 보인다).
// keys.json의 admin 칸은 교사판 열쇠로 잠근 {codes, keys}다. 교사 코드로 입장한 사람만 현재 코드를 보고,
// 바꾸면 이 브라우저에서 새 keys.json(새 코드로 각 판 열쇠를 다시 잠금)을 만들어 GitHub API로 저장소에 올린다.
// 수업 자료(d/*.bin)는 판 열쇠가 그대로라 다시 만들 필요가 없다.
// 관리 v2(keys.json의 adminV >= 2)로 옮긴 뒤에는 admin 칸이 관리자 루트 키(AR)로 잠겨 있어 여기서는 열지 않고 관리 화면(admin/)으로 안내한다.
// GitHub 토큰은 이 기기에 저장하지 않는다(예전에 저장해 둔 토큰은 열 때 지운다).
const REPO = "ESCssaem/ESCssaem.github.io", KEYS_PATH = "ig1/keys.json", TOKEN_KEY = "esc-ig1-gh";
const EDS = [["teacher", "관리자 교사판"], ["colleague", "동교과 교사판"], ["student", "학생판"]];
const b64 = (u8) => { let s = ""; for (let j = 0; j < u8.length; j += 0x8000) s += String.fromCharCode(...u8.subarray(j, j + 0x8000)); return btoa(s); };
const isV2 = (K) => !!K && Number.isInteger(K.adminV) && K.adminV >= 2;

async function sealB64(key, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text)));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return b64(out);
}

// 관리자 교사판 열쇠로 관리 정보 열기 → {codes, keys} (없거나 못 열면 null)
async function readAdmin(v, K) {
  if (!K.admin || v.ed !== "teacher" || isV2(K)) return null;
  try {
    const key = await crypto.subtle.importKey("raw", unb64(v.k), "AES-GCM", false, ["decrypt"]);
    return JSON.parse(new TextDecoder().decode(await openSealed(key, unb64(K.admin))));
  } catch (_) { return null; }
}

// 새 코드로 keys.json 내용 만들기(lessons 등 나머지는 그대로)
async function makeKeys(K, admin, codes) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), slots = [];
  for (const [ed] of EDS) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(codes[ed]), "PBKDF2", false, ["deriveKey"]);
    const kek = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: K.iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
    slots.push(await sealB64(kek, JSON.stringify({ ed, k: admin.keys[ed] })));
  }
  for (let j = slots.length - 1; j > 0; j--) { const r = crypto.getRandomValues(new Uint32Array(1))[0] % (j + 1); [slots[j], slots[r]] = [slots[r], slots[j]]; }
  const tkey = await crypto.subtle.importKey("raw", unb64(admin.keys.teacher), "AES-GCM", false, ["encrypt"]);
  const adminBlob = await sealB64(tkey, JSON.stringify({ codes, keys: admin.keys }));
  return { ...K, salt: b64(salt), slots, admin: adminBlob, codesUpdated: new Date().toISOString() };
}

async function gh(token, method, url, body) {
  const r = await fetch("https://api.github.com/repos/" + REPO + "/contents/" + url, {
    method, headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    body: body && JSON.stringify(body),
  });
  if (r.ok) return r.json();
  const why = { 401: "토큰이 맞지 않거나 만료되었습니다", 403: "토큰에 이 저장소 쓰기 권한(Contents: Read and write)이 없습니다", 404: "토큰이 이 저장소에 접근할 수 없습니다", 409: "그 사이 저장소가 바뀌었습니다. 다시 저장해 주세요", 422: "저장 요청이 거절되었습니다" }[r.status];
  throw new Error(why || "GitHub 오류 " + r.status);
}

async function commitKeys(token, json) {
  const cur = await gh(token, "GET", KEYS_PATH + "?ref=main");
  // 그 사이 관리 v2로 옮겨졌으면 옛 형식으로 덮어쓰지 않는다.
  let remote = null;
  try { remote = JSON.parse(new TextDecoder().decode(unb64(String(cur.content).replace(/\s+/g, "")))); } catch (_) {}
  if (!remote || isV2(remote)) throw new Error("관리 방식이 바뀌었거나 저장소의 keys.json을 읽지 못했습니다. 새 관리 화면(admin/)을 써 주세요");
  const content = b64(new TextEncoder().encode(JSON.stringify(json) + "\n"));
  await gh(token, "PUT", KEYS_PATH, { message: "통합과학1 수업 자료 접속 코드 변경(관리자 교사판)", content, sha: cur.sha, branch: "main" });
}

function checkCodes(codes) {
  const vals = EDS.map(([ed]) => codes[ed]);
  if (vals.some((c) => c.length < 6)) return "코드는 6자 이상으로 정해 주세요.";
  if (vals.some((c) => /\s/.test(c))) return "코드에 띄어쓰기를 넣을 수 없습니다.";
  if (new Set(vals).size !== vals.length) return "세 코드는 서로 달라야 합니다.";
  return "";
}

// 목차 아래 관리 화면
async function mountAdmin(v, box) {
  box.textContent = "";
  try { localStorage.removeItem(TOKEN_KEY); } catch (_) {}
  let K; try { K = await (await fresh("keys.json")).json(); } catch (_) { return; }
  if (isV2(K)) {
    if (v.ed === "teacher") box.innerHTML = '<section class="admin"><h2>접속 코드 관리</h2><p class="note">접속 코드 관리는 새 관리 화면에서 합니다. <a href="admin/">관리 화면 열기</a></p></section>';
    return;
  }
  const admin = await readAdmin(v, K);
  if (!admin) {
    if (v.ed === "teacher") box.innerHTML = '<section class="admin"><h2>접속 코드 관리</h2><p class="note">관리 정보를 열지 못했습니다. 잠그기 후 교사 코드로 다시 입장해 주세요.</p></section>';
    return;
  }
  const sec = document.createElement("section"); sec.className = "admin";
  sec.innerHTML = '<h2>접속 코드 관리 <small>관리자 교사판에서만 보입니다</small></h2>' +
    '<div class="codes"></div>' +
    '<label class="tok">GitHub 토큰 <small>저장할 때만 필요 · 이 기기에 저장하지 않습니다 · <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">토큰 만들기</a>(저장소 ESCssaem.github.io만, Contents: Read and write)</small>' +
    '<input type="password" id="gh-token" autocomplete="off" spellcheck="false" placeholder="github_pat_…"></label>' +
    '<div class="row"><button type="button" id="codes-save">바꾼 코드 저장</button><button type="button" class="ghost" id="codes-undo">처음 값으로</button></div>' +
    '<p class="msg" id="codes-msg" role="status"></p>' +
    '<p class="note">저장하면 1~2분 뒤부터 새 코드로만 입장할 수 있습니다. 이미 입장해 있거나 코드를 기억해 둔 기기는 계속 열립니다(모두 막으려면 Claude에게 열쇠 교체를 요청).<br>관리자 교사판 코드를 바꾸면 새 코드를 꼭 따로 적어 두세요.</p>';
  const list = sec.querySelector(".codes");
  const inputs = {};
  for (const [ed, name] of EDS) {
    const row = document.createElement("div"); row.className = "coderow";
    const lab = document.createElement("label"); lab.textContent = name; lab.htmlFor = "code-" + ed;
    const inp = document.createElement("input"); inp.type = "password"; inp.id = "code-" + ed; inp.value = admin.codes[ed] || "";
    inp.autocomplete = "off"; inp.spellcheck = false; inp.autocapitalize = "off";
    const eye = document.createElement("button"); eye.type = "button"; eye.className = "ghost"; eye.textContent = "보기";
    eye.onclick = () => { const show = inp.type === "password"; inp.type = show ? "text" : "password"; eye.textContent = show ? "숨기기" : "보기"; };
    const copy = document.createElement("button"); copy.type = "button"; copy.className = "ghost"; copy.textContent = "복사";
    copy.onclick = async () => { try { await navigator.clipboard.writeText(inp.value); copy.textContent = "복사됨"; } catch (_) { copy.textContent = "복사 안 됨"; } setTimeout(() => copy.textContent = "복사", 1500); };
    row.append(lab, inp, eye, copy); list.append(row); inputs[ed] = inp;
  }
  box.append(sec);
  const tok = sec.querySelector("#gh-token"), msg = sec.querySelector("#codes-msg"), save = sec.querySelector("#codes-save");
  sec.querySelector("#codes-undo").onclick = () => { for (const [ed] of EDS) inputs[ed].value = admin.codes[ed] || ""; msg.textContent = ""; };
  save.onclick = async () => {
    const codes = Object.fromEntries(EDS.map(([ed]) => [ed, inputs[ed].value.trim()]));
    if (EDS.every(([ed]) => codes[ed] === admin.codes[ed])) { msg.textContent = "바뀐 코드가 없습니다."; return; }
    const bad = checkCodes(codes); if (bad) { msg.textContent = bad; return; }
    const token = tok.value.trim(); if (!token) { msg.textContent = "저장하려면 GitHub 토큰을 넣어 주세요."; tok.focus(); return; }
    save.disabled = true; msg.textContent = "새 코드로 잠그는 중…";
    try {
      const fresh_ = await (await fresh("keys.json")).json();
      if (isV2(fresh_)) throw new Error("관리 방식이 바뀌었습니다. 새 관리 화면(admin/)에서 바꿔 주세요");
      const next = await makeKeys(fresh_, admin, codes);
      msg.textContent = "GitHub에 저장하는 중…";
      await commitKeys(token, next);
      admin.codes = codes; tok.value = "";
      msg.textContent = "저장했습니다. 1~2분 뒤부터 새 코드가 적용됩니다.";
    } catch (e) {
      msg.textContent = "저장하지 못했습니다: " + (e && e.message || e);
    } finally { save.disabled = false; }
  };
}
