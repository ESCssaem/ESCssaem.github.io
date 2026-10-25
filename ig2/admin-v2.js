// 통합과학2 수업 자료 관리 화면 v2 (ig2/admin/). 계약·불변식은 카드 저장소 docs/ig2-admin.md에 있다.
// - 관리 정보(keys.json의 admin)는 관리자 루트 키(AR)로 잠근 {codes, keys}다. AR은 서버 escrow·오프라인 복구 키트로만 다시 얻는다.
// - 게이트(salt/slots/iter) 형식은 그대로다. 바뀐 코드의 slot만 같은 salt로 다시 잠그고 나머지 slot은 바이트 그대로 둔다.
// - 로그인: 교사 코드(authKey = HKDF(PBKDF2(코드, saltA, 600k))) · 복구 키트(RK) · ChatGPT 소유자 1회용 입장권(#t=…, 곧바로 지움).
// - 저장: 서버 prepare → 브라우저가 PAT로 GitHub PUT → 서버가 원격을 직접 읽어 commit. PAT·bearer·AR·코드는 메모리에만 둔다.
// - localStorage/sessionStorage에는 아무것도 쓰지 않는다(게이트가 저장해 둔 교사 입장 정보는 최초 등록 때 읽기만 한다).
(() => {
  "use strict";
  const API = "https://science-educator-card.escssaem.chatgpt.site/api/ig2-admin";
  const SITE_ADMIN = "https://science-educator-card.escssaem.chatgpt.site/admin/ig2";
  const GH_API = "https://api.github.com/repos/ESCssaem/ESCssaem.github.io/contents/ig2/keys.json";
  const EDS = [["teacher", "관리자 교사판"], ["colleague", "동교과 교사판"], ["student", "학생판"]];
  const AUTH_ITER = 600000, GATE_KEY = "esc-ig2-key", TEACHER_MIN = 12, CODE_MIN = 6, CODE_MAX = 128;

  // ----- 순수 암호 함수 (테스트 하네스가 globalThis.IG2Core로 씀) -----
  const enc = new TextEncoder(), dec = new TextDecoder();
  const u8 = (s) => enc.encode(s);
  const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  const fromHex = (h) => {
    if (typeof h !== "string" || !/^(?:[0-9a-f]{2})*$/.test(h)) throw new Error("hex 형식이 아닙니다");
    const o = new Uint8Array(h.length / 2);
    for (let i = 0; i < o.length; i++) o[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    return o;
  };
  const b64 = (b) => { let s = ""; for (let j = 0; j < b.length; j += 0x8000) s += String.fromCharCode(...b.subarray(j, j + 0x8000)); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
  const cat = (...parts) => { const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };
  const sha256Hex = async (b) => toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", b)));
  const isV2 = (K) => !!K && Number.isInteger(K.adminV) && K.adminV >= 2;

  async function hkdf(ikm, info) {
    const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: u8(info) }, k, 256));
  }
  async function pbkdf2(code, salt, iterations) {
    const k = await crypto.subtle.importKey("raw", u8(code), "PBKDF2", false, ["deriveBits"]);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, k, 256));
  }
  // 게이트(gate.js unlock)와 같게 앞뒤 공백만 뺀 코드를 쓴다.
  const authKeyOf = async (code, saltAHex, iter) => toHex(await hkdf(await pbkdf2(code.trim(), fromHex(saltAHex), iter), "ig2/auth/v1"));
  const rkAuthOf = async (rk) => toHex(await hkdf(rk, "ig2/rk-auth/v1"));
  const rkWrapKey = async (rk) => crypto.subtle.importKey("raw", await hkdf(rk, "ig2/rk-wrap/v1"), "AES-GCM", false, ["encrypt", "decrypt"]);
  // 서버(app/lib/ig2-admin.ts arIdOf)와 같은 식: SHA-256("ig2/ar-id/v1" ‖ AR)의 앞 16바이트.
  const arIdOf = async (ar) => (await sha256Hex(cat(u8("ig2/ar-id/v1"), ar))).slice(0, 32);

  async function aesSeal(key, pt, aad) {
    const iv = rand(12), p = { name: "AES-GCM", iv };
    if (aad) p.additionalData = u8(aad);
    return b64(cat(iv, new Uint8Array(await crypto.subtle.encrypt(p, key, pt))));
  }
  async function aesOpen(key, blob, aad) {
    const b = unb64(blob), p = { name: "AES-GCM", iv: b.slice(0, 12) };
    if (aad) p.additionalData = u8(aad);
    return new Uint8Array(await crypto.subtle.decrypt(p, key, b.slice(12)));
  }
  const rawAes = (raw, use) => crypto.subtle.importKey("raw", raw, "AES-GCM", false, use);

  function checkMeta(m) {
    for (const [ed] of EDS) if (!m || !m.codes || !m.keys || typeof m.codes[ed] !== "string" || typeof m.keys[ed] !== "string") throw new Error("관리 정보 형식이 맞지 않습니다");
    return m;
  }
  const sealAdmin = async (ar, arId, meta) => aesSeal(await rawAes(ar, ["encrypt"]), u8(JSON.stringify({ codes: meta.codes, keys: meta.keys })), "ig2-admin/v2|" + arId);
  const openAdmin = async (ar, arId, blob) => checkMeta(JSON.parse(dec.decode(await aesOpen(await rawAes(ar, ["decrypt"]), blob, "ig2-admin/v2|" + arId))));
  // legacy admin: 교사판 열쇠로 잠근 {codes, keys}(AAD 없음, build.mjs·admin.js 옛 형식)
  const openLegacyAdmin = async (teacherKeyB64, blob) => checkMeta(JSON.parse(dec.decode(await aesOpen(await rawAes(unb64(teacherKeyB64), ["decrypt"]), blob, null))));

  async function gateKek(code, saltB64, iter, use) {
    const base = await crypto.subtle.importKey("raw", u8(code.trim()), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt: unb64(saltB64), iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, use);
  }
  async function findSlot(kek, slots) {
    for (let i = 0; i < slots.length; i++) {
      try { const v = JSON.parse(dec.decode(await aesOpen(kek, slots[i], null))); return { index: i, ed: v.ed, k: v.k }; } catch (_) {}
    }
    return null;
  }

  // 바뀐 코드의 slot만 같은 salt·iter로 다시 잠근다(그 자리 그대로). 나머지 필드는 그대로 두고 admin만 AR로 새로 잠근다.
  async function buildCandidate(baseText, { meta, ar, arId, changes }) {
    const base = JSON.parse(baseText);
    if (!Array.isArray(base.slots) || base.slots.length !== 3 || !(base.iter >= 310000)) throw new Error("keys.json 게이트 형식이 예상과 다릅니다");
    const slots = base.slots.slice();
    for (const c of changes) {
      const found = await findSlot(await gateKek(c.oldCode, base.salt, base.iter, ["decrypt"]), slots);
      if (!found || found.ed !== c.ed || found.k !== meta.keys[c.ed]) throw new Error("기존 " + c.ed + " slot을 찾지 못했습니다");
      slots[found.index] = await aesSeal(await gateKek(c.newCode, base.salt, base.iter, ["encrypt"]), u8(JSON.stringify({ ed: c.ed, k: found.k })), null);
    }
    const doc = { ...base, slots, admin: await sealAdmin(ar, arId, meta), adminV: 2, arId, codesUpdated: new Date().toISOString() };
    return { doc, text: JSON.stringify(doc) + "\n", changedSlots: changes.length };
  }

  // 올리기 전 자기 검사: 세 코드가 각자 자기 판 열쇠를 열고, admin이 AR로 열려 같은 내용인지.
  async function selfCheck(doc, meta, ar, arId) {
    for (const [ed] of EDS) {
      const f = await findSlot(await gateKek(meta.codes[ed], doc.salt, doc.iter, ["decrypt"]), doc.slots);
      if (!f || f.ed !== ed || f.k !== meta.keys[ed]) throw new Error("자기 검사 실패: " + ed + " 코드가 자기 판을 열지 못합니다");
    }
    const back = await openAdmin(ar, arId, doc.admin);
    if (JSON.stringify(back) !== JSON.stringify({ codes: meta.codes, keys: meta.keys })) throw new Error("자기 검사 실패: 관리 정보가 다릅니다");
  }

  const hashesOf = async (cand) => ({
    candidateHash: await sha256Hex(u8(cand.text)),
    adminHash: await sha256Hex(u8(cand.doc.admin)),
    slotsHash: await sha256Hex(u8(cand.doc.salt + "|" + JSON.stringify(cand.doc.slots))),
  });

  const formatRk = (rk) => toHex(rk).match(/.{4}/g).join("-");
  const parseRk = (s) => { const h = String(s || "").toLowerCase().replace(/[^0-9a-f]/g, ""); return h.length === 64 ? fromHex(h) : null; };

  // 오프라인 복구 키트: RK + RK로 감싼 AR + 그 시점 keys.json(AR로 잠근 admin 포함) 백업. AR을 바꾸기 전까지 계속 쓸 수 있다.
  async function makeKit({ rk, ar, arId, keysText }) {
    return JSON.stringify({
      format: "ig2-recovery-kit", v: 1, arId, rk: formatRk(rk),
      recoveryBlob: await aesSeal(await rkWrapKey(rk), ar, "ig2-rk/v1|" + arId),
      keysJson: keysText, createdAt: new Date().toISOString(),
      note: "이 파일만 있으면 통합과학2 모든 접속 코드와 판 열쇠를 열 수 있습니다. 인터넷에 올리지 말고 오프라인(USB·종이)으로 보관하세요.",
    }, null, 2);
  }
  async function openKit(text) {
    const kit = JSON.parse(text);
    if (!kit || kit.format !== "ig2-recovery-kit" || kit.v !== 1 || !/^[0-9a-f]{32}$/.test(kit.arId)) throw new Error("복구 키트 형식이 아닙니다");
    const rk = parseRk(kit.rk);
    if (!rk) throw new Error("키트의 복구 키 형식이 맞지 않습니다");
    const ar = await aesOpen(await rkWrapKey(rk), kit.recoveryBlob, "ig2-rk/v1|" + kit.arId);
    if (ar.length !== 32 || (await arIdOf(ar)) !== kit.arId) throw new Error("복구 키트가 손상되었습니다");
    return { rk, ar, arId: kit.arId, keysJson: typeof kit.keysJson === "string" ? kit.keysJson : null };
  }

  function checkCodes(codes) {
    const vals = EDS.map(([ed]) => codes[ed]);
    if (vals.some((c) => typeof c !== "string" || c.length < CODE_MIN || c.length > CODE_MAX)) return `코드는 ${CODE_MIN}자 이상 ${CODE_MAX}자 이하로 정해 주세요.`;
    if (Array.from(codes.teacher).length < TEACHER_MIN) return `관리자 교사판 코드는 ${TEACHER_MIN}자 이상이어야 합니다.`;
    if (vals.some((c) => /\s/.test(c))) return "코드에 띄어쓰기를 넣을 수 없습니다.";
    if (new Set(vals).size !== vals.length) return "세 코드는 서로 달라야 합니다.";
    return "";
  }

  const Core = { toHex, fromHex, b64, unb64, sha256Hex, hkdf, authKeyOf, rkAuthOf, arIdOf, sealAdmin, openAdmin, openLegacyAdmin, gateKek, findSlot, buildCandidate, selfCheck, hashesOf, formatRk, parseRk, makeKit, openKit, checkCodes, isV2 };
  globalThis.IG2Core = Core;
  if (typeof document === "undefined") return;

  // ----- 화면 상태 (메모리만) -----
  // gen: 로그아웃·화면 전환 때 올려서, 늦게 끝난 비동기 작업이 새 화면을 건드리지 못하게 한다. ctl로 진행 중인 fetch도 끊는다.
  const S = { gen: 0, ctl: new AbortController(), params: null, bearer: null, grant: null, ar: null, arId: null, meta: null, pending: null, serverPending: null, timer: 0 };
  const app = document.getElementById("app");
  const stale = () => new DOMException("stale", "AbortError");
  const alive = (g) => { if (g !== S.gen) throw stale(); };

  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "on") for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
      else if (k in e && k !== "list") e[k] = v; else e.setAttribute(k, v);
    }
    for (const kid of kids) if (kid != null) e.append(kid);
    return e;
  }
  const pw = (id, placeholder) => el("input", { type: "password", id, autocomplete: "off", spellcheck: false, autocapitalize: "off", placeholder: placeholder || "" });
  let msgEl = null;
  const say = (text) => { if (msgEl) msgEl.textContent = text; };
  function screen(title, ...kids) {
    app.textContent = "";
    msgEl = el("p", { className: "msg", role: "status" });
    app.append(el("h1", {}, title), ...kids, msgEl);
  }
  const fail = (e) => { if (e && e.name === "AbortError") return; say((e && e.message) || String(e)); };
  const guarded = (btn, fn) => async () => { btn.disabled = true; try { await fn(); } catch (e) { fail(e); } finally { btn.disabled = false; } };

  async function api(path, body, token) {
    const init = { method: body === undefined ? "GET" : "POST", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", signal: S.ctl.signal };
    if (body !== undefined) {
      init.headers = { "Content-Type": "application/json" };
      if (token) init.headers.Authorization = "Bearer " + token;
      init.body = JSON.stringify(body);
    }
    const r = await fetch(API + path, init);
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  }
  const apiError = (res) => new Error((res.data && res.data.error) || "요청에 실패했습니다 (HTTP " + res.status + ")");

  const ghHeaders = (pat) => ({ Authorization: "Bearer " + pat, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" });
  const ghWhy = (s) => ({ 401: "토큰이 맞지 않거나 만료되었습니다.", 403: "토큰에 이 저장소 쓰기 권한(Contents: Read and write)이 없습니다.", 404: "토큰이 이 저장소에 접근할 수 없습니다.", 409: "그 사이 저장소가 바뀌었습니다.", 422: "저장 요청이 거절되었습니다." })[s] || "GitHub 오류 " + s;
  async function ghGet(pat) {
    const r = await fetch(GH_API + "?ref=main", { headers: ghHeaders(pat), cache: "no-store", referrerPolicy: "no-referrer", signal: S.ctl.signal });
    if (!r.ok) throw new Error(ghWhy(r.status));
    const j = await r.json();
    const bytes = unb64(String(j.content).replace(/\s+/g, ""));
    return { sha: j.sha, bytes, text: dec.decode(bytes) };
  }
  async function ghPut(pat, text, sha) {
    const r = await fetch(GH_API, {
      method: "PUT", headers: ghHeaders(pat), referrerPolicy: "no-referrer", signal: S.ctl.signal,
      body: JSON.stringify({ message: "통합과학2 수업 자료 관리 정보 변경(관리 v2)", content: b64(u8(text)), sha, branch: "main" }),
    });
    return r.status;
  }

  // 공개 keys.json(Pages, 1~10분 캐시) → arId가 다르면 GitHub API(비인증)로 한 번 더.
  async function publicKeys(wantArId) {
    try { const d = await (await fetch("../keys.json", { cache: "no-cache", signal: S.ctl.signal })).json(); if (wantArId === undefined || d.arId === wantArId) return d; } catch (e) { if (e.name === "AbortError") throw e; }
    const r = await fetch(GH_API + "?ref=main", { headers: { Accept: "application/vnd.github+json" }, cache: "no-store", referrerPolicy: "no-referrer", signal: S.ctl.signal });
    if (!r.ok) throw new Error("keys.json을 읽지 못했습니다 (HTTP " + r.status + ")");
    const d = JSON.parse(dec.decode(unb64(String((await r.json()).content).replace(/\s+/g, ""))));
    if (wantArId !== undefined && d.arId !== wantArId) throw new Error("공개 keys.json이 아직 갱신되지 않았습니다. 1~2분 뒤 다시 시도해 주세요.");
    return d;
  }

  function wipe() {
    clearTimeout(S.timer);
    if (S.ar) S.ar.fill(0);
    Object.assign(S, { bearer: null, grant: null, ar: null, arId: null, meta: null, pending: null, serverPending: null });
  }
  // 로그아웃: 세대를 올리고 진행 중 요청을 끊은 뒤 코드·PAT 입력·키트 화면을 모두 지운다.
  function logout(note) {
    const token = S.bearer || S.grant;
    S.gen++; S.ctl.abort(); S.ctl = new AbortController();
    wipe(); app.textContent = "";
    if (token) fetch(API + "/logout", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: "{}", credentials: "omit", referrerPolicy: "no-referrer" }).catch(() => {});
    renderLogin(note || "");
  }
  const scheduleExpiry = (at) => { clearTimeout(S.timer); S.timer = setTimeout(() => logout("세션이 끝났습니다. 다시 로그인해 주세요."), Math.max(0, at - Date.now())); };

  // ----- 로그인 -----
  function renderLogin(note) {
    const p = S.params;
    const kids = [];
    if (p && p.configured) {
      const code = pw("code", "관리자 교사판 코드");
      const go = el("button", { type: "button" }, "로그인");
      go.onclick = guarded(go, () => loginCode(code.value));
      kids.push(el("section", { className: "card" }, el("h2", {}, "교사 코드로 로그인"), el("div", { className: "row" }, code, go)));
    } else if (p) {
      kids.push(el("p", { className: "note" }, "아직 새 관리 방식이 등록되지 않았습니다. 명함 소유자가 Sites 관리 화면에서 ‘최초 등록용 입장권’을 만들어 시작합니다. 그 전까지는 목차 화면의 기존 관리(교사 코드로 입장)를 그대로 씁니다."));
    } else {
      kids.push(el("p", { className: "note" }, "IG2 관리 서버가 아직 켜지지 않았거나 연결되지 않습니다. 복구 키트가 있으면 이 기기에서만 코드를 볼 수 있습니다. ", el("a", { href: "../" }, "목차로")));
    }
    const file = el("input", { type: "file", accept: "application/json,.json" });
    const kitGo = el("button", { type: "button", className: "ghost" }, "키트로 열기");
    kitGo.onclick = guarded(kitGo, async () => { if (!file.files[0]) throw new Error("키트 파일을 골라 주세요."); await loginKit(await file.files[0].text()); file.value = ""; });
    kids.push(el("section", { className: "card" }, el("h2", {}, "오프라인 복구 키트로 열기"), el("div", { className: "row" }, file, kitGo)));
    kids.push(el("section", { className: "card" }, el("h2", {}, "코드를 잊었을 때"),
      el("p", { className: "note" }, "명함 소유자 ChatGPT 계정으로 Sites 관리 화면에 로그인해 1회용 입장권을 만들면 바로 복구됩니다. ",
        el("a", { href: SITE_ADMIN, target: "_blank", rel: "noopener noreferrer" }, "Sites 관리 화면 열기"))));
    screen("통합과학2 접속 코드 관리", ...kids);
    say(note);
  }

  async function loginCode(code) {
    const g = S.gen, p = S.params;
    if (!code.trim()) throw new Error("코드를 넣어 주세요.");
    say("확인하는 중… (몇 초 걸립니다)");
    const authKey = await authKeyOf(code, p.saltA, p.iter); alive(g);
    const r = await api("/session", { authKey }); alive(g);
    if (!r.ok) throw apiError(r);
    await enterSession(r.data, g);
  }

  async function enterSession(data, g) {
    S.bearer = data.bearer; S.ar = fromHex(data.ar); S.arId = data.arId; S.serverPending = data.pending || null;
    scheduleExpiry(data.expiresAt);
    try {
      const doc = await publicKeys(S.arId); alive(g);
      S.meta = await openAdmin(S.ar, S.arId, doc.admin); alive(g);
    } catch (e) {
      if (e.name === "AbortError") throw e;
      // 공개 keys.json이 아직 서버 상태와 다르면(진행 중 변경·캐시·GitHub 장애) 로그인과 AR은 그대로 두고 다시 시도하게 한다.
      renderWait("로그인은 됐지만 공개 keys.json을 아직 열 수 없습니다: " + e.message + "\n잠시 뒤 ‘다시 불러오기’를 누르거나, 진행 중인 변경을 확정해 주세요. 복구 키트가 있으면 이 기기에서 바로 열 수도 있습니다.");
      return;
    }
    renderManage(data.reconciled === "committed" ? "진행 중이던 변경을 원격과 맞춰 확정했습니다." : "");
  }

  function renderWait(note) {
    const again = el("button", { type: "button" }, "다시 불러오기");
    const out = el("button", { type: "button", className: "ghost" }, "로그아웃");
    out.onclick = () => logout("로그아웃했습니다.");
    again.onclick = guarded(again, async () => {
      const g = S.gen;
      const doc = await publicKeys(S.arId); alive(g);
      S.meta = await openAdmin(S.ar, S.arId, doc.admin); alive(g);
      renderManage("");
    });
    screen("통합과학2 접속 코드 관리", el("section", { className: "card" }, el("div", { className: "row" }, again, out)), el("div", { id: "pending" }));
    renderPending();
    say(note);
  }

  const superseded = () => logout("이전에 올린 다른 변경이 원격에서 확인되어 확정되었습니다. 다시 로그인해 주세요.");

  async function loginKit(text) {
    const g = S.gen;
    say("키트를 여는 중…");
    const kit = await openKit(text); alive(g);
    let doc = null;
    try { doc = await publicKeys(kit.arId); } catch (e) { if (e.name === "AbortError") throw e; }
    alive(g);
    if (!doc && kit.keysJson) { const d = JSON.parse(kit.keysJson); if (d.arId === kit.arId) doc = d; }
    if (!doc) throw new Error("이 키트의 AR과 맞는 keys.json을 찾지 못했습니다(키트가 교체 전 것일 수 있습니다).");
    S.ar = kit.ar; S.arId = kit.arId; S.meta = await openAdmin(kit.ar, kit.arId, doc.admin); alive(g);
    let note = "키트로 열었습니다(서버 없이). 코드를 바꾸려면 서버 연결이 필요합니다.";
    if (S.params && S.params.configured) {
      const r = await api("/rk/session", { rkAuth: await rkAuthOf(kit.rk) }); alive(g);
      if (r.ok) { S.bearer = r.data.bearer; S.serverPending = r.data.pending || null; scheduleExpiry(r.data.expiresAt); note = r.data.escrowOk === false ? "서버 비밀값이 바뀌었습니다. ‘AR·복구 키 교체’로 다시 맡겨 주세요." : ""; }
      else note = "키트로 열었습니다. 서버 로그인은 실패했습니다: " + ((r.data && r.data.error) || r.status);
    }
    renderManage(note);
  }

  async function redeem(ticket) {
    const g = S.gen;
    say("입장권을 확인하는 중…");
    const r = await api("/owner/redeem", { ticket }); alive(g);
    if (!r.ok) { renderLogin((r.data && r.data.error) || "입장권을 쓰지 못했습니다."); return; }
    if (r.data.mode === "setup") { S.grant = r.data.setupGrant; scheduleExpiry(r.data.expiresAt); renderSetup(); return; }
    await enterSession(r.data, g);
  }

  // ----- 최초 등록 (OWNER setup grant) -----
  function savedTeacherKey() {
    for (const st of [sessionStorage, localStorage]) {
      try { const v = JSON.parse(st.getItem(GATE_KEY) || "null"); if (v && v.ed === "teacher" && typeof v.k === "string") return v; } catch (_) {}
    }
    return null;
  }

  function renderSetup(note) {
    const saved = savedTeacherKey();
    const cur = pw("cur", "지금 쓰는 관리자 교사판 코드");
    const useSaved = el("input", { type: "checkbox", checked: !!saved, disabled: !saved });
    const n1 = pw("new1", `새 관리자 교사판 코드(${TEACHER_MIN}자 이상)`), n2 = pw("new2", "새 코드 한 번 더");
    const pat = pw("pat", "github_pat_…");
    const go = el("button", { type: "button" }, "등록 시작");
    const cancel = el("button", { type: "button", className: "ghost" }, "그만두기");
    cancel.onclick = () => logout("");
    go.onclick = guarded(go, async () => {
      const g = S.gen;
      if (n1.value !== n2.value) throw new Error("새 코드 두 칸이 다릅니다.");
      say("기존 관리 정보를 여는 중…");
      const doc = await publicKeys(); alive(g);
      if (isV2(doc)) throw new Error("이미 새 방식으로 바뀌어 있습니다. 새로고침해 주세요.");
      let k = useSaved.checked && saved ? saved.k : null;
      if (!k) {
        const f = await findSlot(await gateKek(cur.value, doc.salt, doc.iter, ["decrypt"]), doc.slots); alive(g);
        if (!f || f.ed !== "teacher") throw new Error("관리자 교사판 코드가 맞지 않습니다.");
        k = f.k;
      }
      const meta = await openLegacyAdmin(k, doc.admin); alive(g);
      if (meta.keys.teacher !== k) throw new Error("관리 정보가 교사판 열쇠와 맞지 않습니다.");
      const next = { ...meta.codes, teacher: n1.value.trim() };
      if (next.teacher === meta.codes.teacher) throw new Error("마이그레이션 때는 관리자 교사판 코드를 반드시 새 코드로 바꿔야 합니다(옛 코드는 git 기록에 남은 옛 관리 정보로 알 수 있음).");
      const bad = checkCodes(next); if (bad) throw new Error(bad);
      S.meta = meta;
      await runChange("setup", { teacher: next.teacher }, pat);
    });
    screen("최초 등록 (소유자)",
      el("p", { className: "note" }, "기존 관리 정보를 이 브라우저에서 열고, 새 관리자 루트 키(AR)·복구 키트·새 관리자 교사판 코드를 만들어 GitHub에 올립니다. 학생판·동교과 코드와 수업 자료는 바뀌지 않습니다."),
      el("section", { className: "card" },
        el("label", {}, useSaved, saved ? " 이 기기에 저장된 교사 입장 정보 사용" : " (이 기기에 저장된 교사 입장 정보 없음)"),
        el("div", { className: "row" }, cur),
        el("h2", {}, "새 관리자 교사판 코드"), el("div", { className: "row" }, n1), el("div", { className: "row" }, n2),
        el("h2", {}, "GitHub 토큰"), el("p", { className: "note" }, "저장할 때만 쓰고 기기에 남기지 않습니다. 저장소 ESCssaem.github.io만, Contents: Read and write."), el("div", { className: "row" }, pat),
        el("div", { className: "row" }, go, cancel)),
      el("div", { id: "pending" }), el("div", { id: "kit" }));
    say(note || "");
  }

  // ----- 관리 -----
  function renderManage(note) {
    const inputs = {};
    const list = el("div", { className: "codes" });
    for (const [ed, name] of EDS) {
      const inp = pw("code-" + ed); inp.value = S.meta.codes[ed];
      const eye = el("button", { type: "button", className: "ghost" }, "보기");
      eye.onclick = () => { const show = inp.type === "password"; inp.type = show ? "text" : "password"; eye.textContent = show ? "숨기기" : "보기"; };
      const copy = el("button", { type: "button", className: "ghost" }, "복사");
      copy.onclick = async () => { try { await navigator.clipboard.writeText(inp.value); copy.textContent = "복사됨"; } catch (_) { copy.textContent = "복사 안 됨"; } setTimeout(() => (copy.textContent = "복사"), 1500); };
      list.append(el("div", { className: "coderow" }, el("label", { htmlFor: inp.id }, name), inp, eye, copy));
      inputs[ed] = inp;
    }
    const pat = pw("pat", "github_pat_…");
    const save = el("button", { type: "button", disabled: !S.bearer }, "바꾼 코드 저장");
    const rot = el("button", { type: "button", className: "ghost", disabled: !S.bearer }, "AR·복구 키 교체");
    const out = el("button", { type: "button", className: "ghost" }, "로그아웃");
    out.onclick = () => logout("로그아웃했습니다.");
    const read = () => Object.fromEntries(EDS.map(([ed]) => [ed, inputs[ed].value.trim()]));
    save.onclick = guarded(save, async () => {
      const codes = read();
      if (EDS.every(([ed]) => codes[ed] === S.meta.codes[ed])) throw new Error("바뀐 코드가 없습니다.");
      const bad = checkCodes(codes); if (bad) throw new Error(bad);
      await runChange("update", codes, pat);
    });
    rot.onclick = guarded(rot, async () => {
      if (!confirm("새 AR과 새 복구 키트를 만듭니다. 확정되면 지금 갖고 있는 키트는 더 이상 쓸 수 없습니다. 계속할까요?")) return;
      const codes = read(); const bad = checkCodes(codes); if (bad) throw new Error(bad);
      await runChange("rotate", codes, pat);
    });
    const pend = el("div", { id: "pending" });
    screen("통합과학2 접속 코드 관리",
      el("section", { className: "card" }, list,
        el("h2", {}, "GitHub 토큰"), el("p", { className: "note" }, "저장할 때만 쓰고 기기에 남기지 않습니다. 저장소 ESCssaem.github.io만, Contents: Read and write."), el("div", { className: "row" }, pat),
        el("div", { className: "row" }, save, rot, out),
        el("p", { className: "note" }, "저장하면 1~2분 뒤부터 새 코드로만 입장할 수 있습니다. 이미 입장해 있거나 코드를 기억해 둔 기기는 계속 열립니다. 관리자 교사판 코드를 바꾸면 새 코드를 따로 적어 두세요.")),
      pend, el("div", { id: "kit" }));
    renderPending();
    say(note || "");
  }

  function renderPending() {
    const box = document.getElementById("pending");
    if (!box) return;
    box.textContent = "";
    const sp = S.pending ? { pendingId: S.pending.pendingId, kind: S.pending.kind } : S.serverPending;
    if (!sp || !(S.bearer || S.grant)) return;
    const retry = el("button", { type: "button" }, "원격 확인 후 확정");
    const abort = el("button", { type: "button", className: "ghost" }, "변경 취소");
    const row = el("div", { className: "row" }, retry, abort);
    retry.onclick = guarded(retry, () => commitLoop(S.gen, sp.pendingId));
    // 원격이 예상과 어긋나(diverged·invalid) 취소가 거절되면 강제 정리를 보인다. 원격이 이미 이 변경과 같으면 서버는 force여도 확정한다.
    const doAbort = async (force) => {
      const g = S.gen;
      const r = await api("/abort", force ? { pendingId: sp.pendingId, force: true } : { pendingId: sp.pendingId }, S.bearer || S.grant); alive(g);
      if (!r.ok) {
        const code = r.data && r.data.code;
        if (!force && (code === "remote_diverged" || code === "remote_invalid") && !row.querySelector(".force")) {
          const f = el("button", { type: "button", className: "ghost force" }, "강제 정리");
          f.onclick = guarded(f, async () => {
            if (!confirm("GitHub의 keys.json이 이 변경과도, 확정된 상태와도 다릅니다. 강제 정리하면 이 변경은 보관함으로 옮겨지고(원격이 나중에 이 변경과 같아지면 자동 확정), 확정된 상태는 그대로 둡니다. 원격 keys.json은 키트의 백업 등으로 직접 바로잡아야 할 수 있습니다. 계속할까요?")) return;
            await doAbort(true);
          });
          row.append(f);
        }
        throw apiError(r);
      }
      if (r.data.status === "committed" || r.data.status === "superseded") return afterCommit(r.data, g);
      S.pending = null; S.serverPending = null; renderPending(); say(force ? "진행 중이던 변경을 강제 정리했습니다." : "진행 중이던 변경을 취소했습니다.");
    };
    abort.onclick = guarded(abort, () => doAbort(false));
    box.append(el("section", { className: "card warn" }, el("p", {}, "진행 중인 변경(" + sp.kind + ")이 있습니다. GitHub에 이미 올라갔다면 확정되고, 아니면 취소할 수 있습니다. 다른 기기에서 시작한 변경은 15분 뒤부터 정리할 수 있습니다."), row));
  }

  // 새 AR이면 키트를 내려받고 복구 키를 다시 입력해야 다음 단계로 간다(확정 전까지는 옛 키트·옛 escrow가 그대로 유효).
  function confirmKit(kitText, rk, g) {
    return new Promise((resolve, reject) => {
      const box = document.getElementById("kit");
      let downloaded = false;
      const dl = el("button", { type: "button" }, "복구 키트 내려받기");
      dl.onclick = () => {
        const url = URL.createObjectURL(new Blob([kitText], { type: "application/json" }));
        const a = el("a", { href: url, download: "ig2-recovery-kit.json", rel: "noopener" }); document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000); downloaded = true;
      };
      const again = el("input", { type: "text", autocomplete: "off", spellcheck: false, placeholder: "키트의 복구 키(rk)를 그대로 입력" });
      const ok = el("button", { type: "button" }, "확인하고 계속");
      const no = el("button", { type: "button", className: "ghost" }, "취소");
      const done = (fn) => { box.textContent = ""; fn(); };
      ok.onclick = () => {
        if (g !== S.gen) return done(() => reject(stale()));
        if (!downloaded) { say("먼저 키트를 내려받아 안전한 곳(오프라인)에 보관해 주세요."); return; }
        const typed = parseRk(again.value);
        if (!typed || toHex(typed) !== toHex(rk)) { say("복구 키가 키트와 다릅니다. 내려받은 파일의 rk 값을 확인해 주세요."); return; }
        done(resolve);
      };
      no.onclick = () => done(() => reject(new Error("취소했습니다. 아무것도 바뀌지 않았습니다.")));
      box.textContent = "";
      box.append(el("section", { className: "card warn" }, el("h2", {}, "새 복구 키트"),
        el("p", { className: "note" }, "이 키트만 있으면 모든 코드와 판 열쇠를 열 수 있습니다. 클라우드·메신저에 올리지 말고 오프라인으로 보관하세요. 확정되면 예전 키트는 쓸 수 없습니다."),
        el("div", { className: "row" }, dl), el("div", { className: "row" }, again), el("div", { className: "row" }, ok, no)));
      say("키트를 내려받고 복구 키를 다시 입력해 주세요.");
    });
  }

  async function runChange(kind, codes, patInput) {
    const g = S.gen;
    const pat = patInput.value.trim();
    if (!pat) throw new Error("GitHub 토큰(PAT)을 넣어 주세요.");
    if (S.pending || S.serverPending) throw new Error("진행 중인 변경을 먼저 확정하거나 취소해 주세요.");
    say("GitHub에서 현재 keys.json을 읽는 중…");
    const base = await ghGet(pat); alive(g);
    const baseDoc = JSON.parse(base.text);
    if (kind === "setup" ? isV2(baseDoc) : !(isV2(baseDoc) && baseDoc.arId === S.arId)) throw new Error("저장소의 keys.json이 예상한 상태가 아닙니다. 새로고침 후 다시 시도해 주세요.");
    const old = S.meta;
    const meta = { codes: { ...old.codes, ...codes }, keys: { ...old.keys } };
    const changes = EDS.map(([ed]) => ed).filter((ed) => meta.codes[ed] !== old.codes[ed]).map((ed) => ({ ed, oldCode: old.codes[ed], newCode: meta.codes[ed] }));
    const newAr = kind !== "update";
    const ar = newAr ? rand(32) : S.ar, arId = newAr ? await arIdOf(ar) : S.arId;
    say("새 keys.json을 만들고 새 코드로 열리는지 확인하는 중… (수십 초 걸릴 수 있습니다)");
    const cand = await buildCandidate(base.text, { meta, ar, arId, changes }); alive(g);
    await selfCheck(cand.doc, meta, ar, arId); alive(g);
    const body = { pendingId: toHex(rand(16)), baseSha: base.sha, baseHash: await sha256Hex(base.bytes), ...(await hashesOf(cand)), arId, changedSlots: cand.changedSlots };
    if (changes.some((c) => c.ed === "teacher")) { const saltA = toHex(rand(16)); body.auth = { saltA, iter: AUTH_ITER, authKey: await authKeyOf(meta.codes.teacher, saltA, AUTH_ITER) }; }
    if (newAr) {
      const rk = rand(32);
      body.rotate = { ar: toHex(ar), rkAuth: await rkAuthOf(rk) };
      await confirmKit(await makeKit({ rk, ar, arId, keysText: cand.text }), rk, g); alive(g);
      rk.fill(0);
    }
    const token = kind === "setup" ? S.grant : S.bearer;
    say("서버에 변경을 등록하는 중…");
    const prep = await api(kind === "setup" ? "/setup" : "/prepare", body, token); alive(g);
    if (!prep.ok) throw apiError(prep);
    if (prep.data.status === "superseded") return superseded();
    S.pending = { pendingId: body.pendingId, kind: prep.data.kind, token, meta, ar, arId };
    if (prep.data.leaseUntil - Date.now() < 120000) {
      await api("/abort", { pendingId: body.pendingId }, token); S.pending = null;
      throw new Error("시간이 부족합니다. 다시 시도해 주세요.");
    }
    say("GitHub에 저장하는 중…");
    let status = 0;
    try { status = await ghPut(pat, cand.text, base.sha); } catch (e) { if (e.name === "AbortError") throw e; }
    alive(g);
    if ([401, 403, 404, 409, 422].includes(status)) {
      const ab = await api("/abort", { pendingId: body.pendingId }, token); alive(g);
      if (ab.ok && ab.data.status === "committed") return afterCommit(ab.data, g);
      if (ab.ok) S.pending = null;
      renderPending();
      throw new Error(ghWhy(status) + (ab.ok ? " 변경은 취소했습니다." : " 변경 취소를 확인하지 못했습니다. 다시 시도해 주세요."));
    }
    patInput.value = "";
    return commitLoop(g, body.pendingId);
  }

  // 원격 확인은 서버가 한다. 아직 반영 전이면 잠깐 기다렸다 다시, GitHub 확인 실패면 pending을 둔 채 다시 시도 버튼을 보인다.
  async function commitLoop(g, pendingId) {
    const token = (S.pending && S.pending.token) || S.bearer || S.grant;
    for (let i = 0; i < 4; i++) {
      say("서버가 GitHub 반영을 확인하는 중…");
      const r = await api("/commit", { pendingId }, token); alive(g);
      if (r.ok) return afterCommit(r.data, g);
      const code = r.data && r.data.code;
      if (code === "remote_not_updated" && i < 3) { await new Promise((res) => setTimeout(res, 4000)); alive(g); continue; }
      if (r.status === 401) {
        const p = await api("/params"); alive(g);
        if (p.ok && S.pending && p.data.arId === S.pending.arId && p.data.ver > 0) return afterCommit({ bearer: null }, g);
      }
      renderPending();
      throw apiError(r);
    }
  }

  async function afterCommit(data, g) {
    if (data.status === "superseded") { S.pending = null; S.serverPending = null; return superseded(); }
    const p = S.pending;
    if (p) { if (S.ar && S.ar !== p.ar) S.ar.fill(0); S.ar = p.ar; S.arId = p.arId; S.meta = p.meta; }
    S.pending = null; S.serverPending = null; S.grant = null;
    if (!data.bearer) { logout("확정했습니다. 새 코드(또는 새 키트)로 다시 로그인해 주세요."); return; }
    S.bearer = data.bearer; scheduleExpiry(data.expiresAt);
    if (!p) { try { S.arId = data.arId; S.meta = await openAdmin(S.ar, S.arId, (await publicKeys(S.arId)).admin); } catch (e) { alive(g); logout("확정했습니다. 다시 로그인해 주세요."); return; } }
    alive(g);
    renderManage("확정했습니다. 1~2분 뒤부터 새 내용이 적용됩니다.");
  }

  // ----- 시작 -----
  async function boot() {
    const m = /^#t=([0-9a-f]{64})$/.exec(location.hash);
    if (location.hash) history.replaceState(null, "", location.pathname + location.search); // 입장권은 읽자마자 주소에서 지운다
    if (window.top !== window.self) { document.body.textContent = "이 화면은 다른 페이지 안에서 열 수 없습니다."; return; }
    const g = S.gen;
    screen("통합과학2 접속 코드 관리");
    say("불러오는 중…");
    try {
      const r = await api("/params"); alive(g);
      S.params = r.ok ? r.data : null;
    } catch (e) { if (e.name === "AbortError") return; S.params = null; }
    if (m && S.params) { try { await redeem(m[1]); } catch (e) { renderLogin(""); fail(e); } return; }
    renderLogin(m ? "서버가 꺼져 있어 입장권을 쓸 수 없습니다." : "");
  }
  boot();
})();
