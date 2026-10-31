// 홈페이지 접속 코드 금고(escssaem.github.io/codes/vault.json)의 암호 함수. Mac 도구(codes-admin.mjs)와
// 사이트 관리 화면(codes/admin.js)이 이 파일 하나를 같이 쓴다(사이트에는 codes/core.js로 복사).
// - 금고 열쇠: ECDH P-256 한 쌍. 공개 열쇠는 vault.json에 그대로 있어서, 빌드 도구는 관리자 코드 없이 새 자료를 금고에 넣을 수 있다.
// - 비밀 열쇠는 관리자 코드(PBKDF2-SHA256 60만 회)와 복구 키(HKDF) 두 가지로 따로 잠가 둔다.
// - 자료 한 칸 = 임시 ECDH 열쇠 + AES-GCM(HKDF(공유 비밀, "esc-codes/v1/" + id), 비밀 JSON, aad = id).
(function (g) {
  "use strict";
  const enc = new TextEncoder(), dec = new TextDecoder();
  const S = g.crypto.subtle;
  const ADMIN_ITER = 600000;
  const b64 = (b) => { let s = ""; for (let j = 0; j < b.length; j += 0x8000) s += String.fromCharCode(...b.subarray(j, j + 0x8000)); return g.btoa(s); };
  const unb64 = (s) => Uint8Array.from(g.atob(s), (c) => c.charCodeAt(0));
  const rand = (n) => g.crypto.getRandomValues(new Uint8Array(n));
  const cat = (a, b) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };

  async function seal(key, pt, aad) {
    const iv = rand(12), p = { name: "AES-GCM", iv };
    if (aad) p.additionalData = enc.encode(aad);
    return cat(iv, new Uint8Array(await S.encrypt(p, key, pt)));
  }
  async function open(key, buf, aad) {
    const p = { name: "AES-GCM", iv: buf.slice(0, 12) };
    if (aad) p.additionalData = enc.encode(aad);
    return new Uint8Array(await S.decrypt(p, key, buf.slice(12)));
  }
  const aes = (raw, use) => S.importKey("raw", raw, "AES-GCM", false, use);
  async function hkdfKey(ikm, info, use) {
    const k = await S.importKey("raw", ikm, "HKDF", false, ["deriveKey"]);
    return S.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode(info) }, k, { name: "AES-GCM", length: 256 }, false, use);
  }
  async function codeKey(code, salt, iter, use) {
    const k = await S.importKey("raw", enc.encode(code.trim()), "PBKDF2", false, ["deriveKey"]);
    return S.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, k, { name: "AES-GCM", length: 256 }, false, use);
  }

  // 복구 키: 32바이트를 읽기 쉬운 글자(헷갈리는 0·O·1·I 뺌)로 4자씩 끊어 보여 준다.
  const RK_ABC = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  function rkToText(b) {
    let bits = "", out = "";
    for (const x of b) bits += x.toString(2).padStart(8, "0");
    for (let i = 0; i < bits.length; i += 5) out += RK_ABC[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
    return out.match(/.{1,4}/g).join("-");
  }
  function rkFromText(t) {
    const s = String(t).toUpperCase().replace(/[^0-9A-Z]/g, "");
    let bits = "";
    for (const c of s) { const v = RK_ABC.indexOf(c); if (v < 0) throw new Error("복구 키 글자가 맞지 않습니다"); bits += v.toString(2).padStart(5, "0"); }
    if (bits.length < 256) throw new Error("복구 키가 짧습니다");
    const o = new Uint8Array(32);
    for (let i = 0; i < 32; i++) o[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
    return o;
  }

  // 새 금고. → {vault, recoveryText}
  async function createVault(adminCode) {
    const kp = await S.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const pub = new Uint8Array(await S.exportKey("raw", kp.publicKey));
    const pk8 = new Uint8Array(await S.exportKey("pkcs8", kp.privateKey));
    const rk = rand(32);
    const vault = { v: 1, pub: b64(pub), admin: null, rec: b64(await seal(await hkdfKey(rk, "esc-codes/v1/recovery", ["encrypt"]), pk8, "rec")), items: {}, order: [] };
    await setAdminCode(vault, pk8, adminCode);
    return { vault, recoveryText: rkToText(rk) };
  }
  async function setAdminCode(vault, pk8, adminCode) {
    const salt = rand(16);
    vault.admin = { iter: ADMIN_ITER, salt: b64(salt), blob: b64(await seal(await codeKey(adminCode, salt, ADMIN_ITER, ["encrypt"]), pk8, "admin")) };
    vault.adminUpdated = new Date().toISOString();
  }
  // 관리자 코드 또는 복구 키로 비밀 열쇠(pkcs8 바이트) 꺼내기. 틀리면 null
  async function unlockWithCode(vault, adminCode) {
    try { return await open(await codeKey(adminCode, unb64(vault.admin.salt), vault.admin.iter, ["decrypt"]), unb64(vault.admin.blob), "admin"); } catch (_) { return null; }
  }
  async function unlockWithRecovery(vault, text) {
    try { return await open(await hkdfKey(rkFromText(text), "esc-codes/v1/recovery", ["decrypt"]), unb64(vault.rec), "rec"); } catch (_) { return null; }
  }

  // 자료 한 칸 넣기(공개 열쇠만 있으면 된다). meta: {title, path, kind, url?}, secret: 자료마다 다른 JSON
  async function putItem(vault, id, meta, secret) {
    const pub = await S.importKey("raw", unb64(vault.pub), { name: "ECDH", namedCurve: "P-256" }, false, []);
    const eph = await S.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const shared = new Uint8Array(await S.deriveBits({ name: "ECDH", public: pub }, eph.privateKey, 256));
    const item = { ...meta, updated: new Date().toISOString() };
    if (secret !== undefined) {
      item.epk = b64(new Uint8Array(await S.exportKey("raw", eph.publicKey)));
      item.blob = b64(await seal(await hkdfKey(shared, "esc-codes/v1/" + id, ["encrypt"]), enc.encode(JSON.stringify(secret)), id));
    }
    vault.items[id] = item;
    if (!vault.order.includes(id)) vault.order.push(id);
  }
  async function readItem(pk8, vault, id) {
    const it = vault.items[id];
    if (!it || !it.blob) return null;
    const priv = await S.importKey("pkcs8", pk8, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    const epk = await S.importKey("raw", unb64(it.epk), { name: "ECDH", namedCurve: "P-256" }, false, []);
    const shared = new Uint8Array(await S.deriveBits({ name: "ECDH", public: epk }, priv, 256));
    return JSON.parse(dec.decode(await open(await hkdfKey(shared, "esc-codes/v1/" + id, ["decrypt"]), unb64(it.blob), id)));
  }

  // ── 자료 형식별 keys.json ──
  // single(예: steam1031): {v, iter, salt, slot}, slot = AES-GCM(PBKDF2(코드), {k})
  async function singleKeys(old, code, k) {
    const salt = old && old.salt ? unb64(old.salt) : rand(16), iter = (old && old.iter) || 310000;
    const slot = await seal(await codeKey(code, salt, iter, ["encrypt"]), enc.encode(JSON.stringify({ k })));
    return { ...(old || { v: 1 }), iter, salt: b64(salt), slot: b64(slot), codesUpdated: new Date().toISOString() };
  }
  async function singleCheck(K, code) {
    try { const v = JSON.parse(dec.decode(await open(await codeKey(code, unb64(K.salt), K.iter, ["decrypt"]), unb64(K.slot)))); return v.k; } catch (_) { return null; }
  }
  // ig1(관리 v1): admin = AES-GCM(교사판 열쇠, {codes, keys}), slots = 판마다 AES-GCM(PBKDF2(코드), {ed, k}) (순서 섞음)
  const EDS = ["teacher", "colleague", "student"];
  async function ig1Admin(K, teacherKey) {
    return JSON.parse(dec.decode(await open(await aes(unb64(teacherKey), ["decrypt"]), unb64(K.admin))));
  }
  async function ig1Keys(K, admin, codes) {
    const salt = rand(16), slots = [];
    for (const ed of EDS) slots.push(b64(await seal(await codeKey(codes[ed], salt, K.iter, ["encrypt"]), enc.encode(JSON.stringify({ ed, k: admin.keys[ed] })))));
    for (let j = slots.length - 1; j > 0; j--) { const r = g.crypto.getRandomValues(new Uint32Array(1))[0] % (j + 1); [slots[j], slots[r]] = [slots[r], slots[j]]; }
    const adminBlob = b64(await seal(await aes(unb64(admin.keys.teacher), ["encrypt"]), enc.encode(JSON.stringify({ codes, keys: admin.keys }))));
    return { ...K, salt: b64(salt), slots, admin: adminBlob, codesUpdated: new Date().toISOString() };
  }

  g.EscVault = { ADMIN_ITER, EDS, b64, unb64, createVault, setAdminCode, unlockWithCode, unlockWithRecovery, putItem, readItem,
    singleKeys, singleCheck, ig1Admin, ig1Keys, rkToText, rkFromText };
})(globalThis);
