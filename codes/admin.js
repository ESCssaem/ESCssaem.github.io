// 접속 코드 관리 화면(escssaem.github.io/codes/). 금고(vault.json)를 관리자 코드나 복구 키로 열어 자료마다 코드를 보여 주고,
// 바꾸면 그 자료의 keys.json(과 금고)을 새로 만들어 GitHub에 한 커밋으로 올린다. 수업·발표 자료 파일(d/*.bin)은 그대로다.
// 관리자 코드·복구 키·비밀 열쇠·GitHub 토큰은 메모리에만 둔다(localStorage/sessionStorage에 쓰지 않음).
// 로컬 시험: 127.0.0.1에서 ?dry=1 이면 GitHub 대신 window.__dry에 바뀔 파일을 남긴다.
(() => {
  "use strict";
  const V = window.EscVault;
  const REPO = "https://api.github.com/repos/ESCssaem/ESCssaem.github.io";
  const DRY = /^(127\.0\.0\.1|localhost)$/.test(location.hostname) && /[?&]dry=1/.test(location.search);
  const ED_NAMES = { teacher: "교사", colleague: "동교과 교사", student: "학생" };
  const app = document.getElementById("app");
  const enc = new TextEncoder(), dec = new TextDecoder();
  let st = null; // {vault, pk8, secrets, ig1: {id: {K, admin}}, token}

  const el = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "on") for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
      else if (k === "text") e.textContent = v;
      else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids) if (c != null) e.append(c);
    return e;
  };
  const fresh = (u) => fetch(u, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); });

  // ── GitHub ──
  async function gh(method, url, body) {
    const r = await fetch(REPO + url, {
      method, headers: { Authorization: "Bearer " + st.token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      body: body && JSON.stringify(body),
    });
    if (r.ok) return r.json();
    const why = { 401: "토큰이 맞지 않거나 만료되었습니다", 403: "토큰에 이 저장소 쓰기 권한(Contents: Read and write)이 없습니다", 404: "토큰이 이 저장소에 접근할 수 없습니다", 409: "저장소 상태가 맞지 않습니다. 다시 저장해 주세요", 422: "그 사이 저장소가 바뀌었습니다. 다시 저장해 주세요" }[r.status];
    throw new Error(why || "GitHub 오류 " + r.status);
  }
  // 저장소의 최신 파일(Pages 캐시가 아니라 main 그대로)
  async function remoteJson(p) {
    if (DRY) return fresh("../" + p);
    const f = await gh("GET", "/contents/" + encodeURI(p) + "?ref=main");
    return JSON.parse(dec.decode(V.unb64(String(f.content).replace(/\s+/g, ""))));
  }
  // 여러 파일을 한 커밋으로
  async function commit(files, message) {
    if (DRY) { window.__dry = { files, message }; return; }
    const ref = await gh("GET", "/git/ref/heads/main");
    const head = await gh("GET", "/git/commits/" + ref.object.sha);
    const tree = await gh("POST", "/git/trees", { base_tree: head.tree.sha, tree: Object.entries(files).map(([path, content]) => ({ path, mode: "100644", type: "blob", content })) });
    const c = await gh("POST", "/git/commits", { message, tree: tree.sha, parents: [ref.object.sha] });
    await gh("PATCH", "/git/refs/heads/main", { sha: c.sha });
  }
  const js = (o) => JSON.stringify(o) + "\n";
  const vaultText = (v) => JSON.stringify(v, null, 1) + "\n";

  function needToken() {
    if (DRY || st.token) return "";
    return "먼저 위쪽 'GitHub 토큰' 칸에 토큰을 넣어 주세요.";
  }
  async function sameVault() {
    const rv = await remoteJson("codes/vault.json");
    if (rv.pub !== st.vault.pub) throw new Error("저장소의 금고가 바뀌었습니다. 새로고침 후 다시 열어 주세요");
    return rv;
  }
  function checkCode(c) {
    if (c.length < 6) return "코드는 6자 이상으로 정해 주세요.";
    if (/\s/.test(c)) return "코드에 띄어쓰기를 넣을 수 없습니다.";
    return "";
  }

  // ── 잠금 해제 ──
  function renderLock(msgText) {
    let mode = "code";
    const input = el("input", { type: "password", id: "secret", autocomplete: "off", autocapitalize: "off", spellcheck: "false" });
    const lab = el("label", { class: "f", for: "secret", text: "관리자 코드" });
    const msg = el("p", { class: "msg", role: "status", text: msgText || "" });
    const tabBtn = (m, t) => el("button", { type: "button", "aria-pressed": String(m === mode), on: { click: (e) => {
      mode = m; lab.textContent = t; input.type = m === "code" ? "password" : "text"; input.value = "";
      for (const b of e.target.parentNode.children) b.setAttribute("aria-pressed", String(b === e.target)); input.focus();
    } } }, t);
    const go = el("button", { type: "submit" }, "열기");
    const form = el("form", { class: "card", on: { submit: async (e) => {
      e.preventDefault(); go.disabled = true; msg.textContent = "여는 중…(몇 초 걸립니다)";
      try {
        const vault = await fresh("vault.json");
        const pk8 = mode === "code" ? await V.unlockWithCode(vault, input.value) : await V.unlockWithRecovery(vault, input.value);
        if (!pk8) { msg.textContent = mode === "code" ? "관리자 코드가 맞지 않습니다." : "복구 키가 맞지 않습니다."; return; }
        input.value = "";
        st = { vault, pk8, secrets: {}, ig1: {}, token: "" };
        await loadAll();
        renderMain();
      } catch (err) { msg.textContent = "열지 못했습니다: " + (err && err.message || err); }
      finally { go.disabled = false; }
    } } },
      el("div", { class: "tabs" }, tabBtn("code", "관리자 코드"), tabBtn("rk", "복구 키")),
      lab, el("div", { class: "row" }, input, go), msg,
      el("p", { class: "note", text: "관리자 코드를 잊었으면 '복구 키'로 열고 아래에서 관리자 코드를 새로 정하세요." }));
    app.replaceChildren(form);
    input.focus();
  }

  async function loadAll() {
    for (const id of st.vault.order) {
      const it = st.vault.items[id];
      if (!it.blob) continue;
      st.secrets[id] = await V.readItem(st.pk8, st.vault, id);
      if (it.kind === "ig1") {
        try {
          const K = await fresh("../" + it.path + "keys.json");
          st.ig1[id] = Number(K.adminV) >= 2 ? { K, v2: true } : { K, admin: await V.ig1Admin(K, st.secrets[id].teacherKey) };
        } catch (_) { st.ig1[id] = { error: true }; }
      }
    }
  }

  // ── 본 화면 ──
  function codeRow(name, value) {
    const out = el("output", { text: "••••••••" });
    let shown = false;
    return el("div", { class: "code" }, el("b", { text: name }), out,
      el("button", { type: "button", class: "ghost", on: { click: (e) => { shown = !shown; out.textContent = shown ? value : "••••••••"; e.target.textContent = shown ? "숨기기" : "보기"; } } }, "보기"),
      el("button", { type: "button", class: "ghost", on: { click: async (e) => { try { await navigator.clipboard.writeText(value); e.target.textContent = "복사됨"; setTimeout(() => (e.target.textContent = "복사"), 1500); } catch (_) {} } } }, "복사"));
  }

  function editBox(fields, onSave) {
    const box = el("div", { class: "edit", hidden: true });
    const inputs = fields.map(([key, label]) => [key, el("input", { type: "text", autocomplete: "off", autocapitalize: "off", spellcheck: "false", placeholder: "새 " + label + " 코드" })]);
    const msg = el("p", { class: "msg", role: "status" });
    const save = el("button", { type: "button", on: { click: async () => {
      const vals = Object.fromEntries(inputs.map(([k, i]) => [k, i.value.trim()]));
      const bad = needToken() || Object.values(vals).map(checkCode).find(Boolean);
      if (bad) { msg.className = "msg"; msg.textContent = bad; return; }
      save.disabled = true; msg.className = "msg"; msg.textContent = "저장하는 중…";
      try {
        await onSave(vals);
        msg.className = "msg ok"; msg.textContent = DRY ? "(시험) 바뀔 파일을 만들었습니다." : "저장했습니다. 1~2분 뒤 사이트에 반영됩니다.";
        inputs.forEach(([, i]) => (i.value = ""));
      } catch (err) { msg.className = "msg"; msg.textContent = "저장하지 못했습니다: " + (err && err.message || err); }
      finally { save.disabled = false; }
    } } }, "저장");
    for (const [key, i] of inputs) box.append(el("label", { class: "f", text: "새 " + fields.find((f) => f[0] === key)[1] + " 코드" }), i);
    box.append(el("div", { class: "row", style: "margin-top:10px" }, save), msg);
    const toggle = el("button", { type: "button", class: "ghost", on: { click: () => { box.hidden = !box.hidden; } } }, "코드 바꾸기");
    return [toggle, box];
  }

  function itemCard(id) {
    const it = st.vault.items[id], s = st.secrets[id];
    const card = el("section", { class: "card" }, el("h2", { text: it.title }),
      el("p", { class: "sub" }, el("a", { href: "../" + it.path, target: "_blank", rel: "noopener", text: "escssaem.github.io/" + it.path })));
    if (it.kind === "link") {
      card.append(el("p", { class: "note", text: it.note || "" }), el("a", { href: "../" + it.url, text: "관리 화면 열기 →" }));
      return card;
    }
    if (it.kind === "single") {
      const rows = el("div", {}, codeRow("접속 코드", s.code));
      const [toggle, box] = editBox([["code", "접속"]], async ({ code }) => {
        const rv = await sameVault();
        const K = await remoteJson(it.path + "keys.json");
        const nk = await V.singleKeys(K, code, s.k);
        if ((await V.singleCheck(nk, code)) !== s.k) throw new Error("새 열쇠 점검 실패");
        await V.putItem(rv, id, { title: it.title, path: it.path, kind: it.kind }, { ...s, code });
        await commit({ [it.path + "keys.json"]: js(nk), "codes/vault.json": vaultText(rv) }, `${it.title}: 접속 코드 변경(접속 코드 관리 화면)`);
        st.vault = rv; st.secrets[id] = { ...s, code };
        rows.replaceChildren(codeRow("접속 코드", code));
      });
      card.append(rows, el("div", { class: "row", style: "margin-top:8px" }, toggle), box);
      return card;
    }
    if (it.kind === "ig1") {
      const g = st.ig1[id] || {};
      if (g.v2) { card.append(el("p", { class: "note" }, "이 자료는 새 관리 방식으로 옮겨졌습니다. ", el("a", { href: "../" + it.path + "admin/", text: "자료의 관리 화면 열기 →" }))); return card; }
      if (!g.admin) { card.append(el("p", { class: "note", text: "현재 코드를 읽지 못했습니다(자료 열쇠가 바뀌었을 수 있음). Mac에서 금고에 다시 등록해야 합니다." })); return card; }
      const rows = el("div", {});
      const draw = () => rows.replaceChildren(...V.EDS.map((ed) => codeRow(ED_NAMES[ed], g.admin.codes[ed])));
      draw();
      const [toggle, box] = editBox(V.EDS.map((ed) => [ed, ED_NAMES[ed]]), async (vals) => {
        if (new Set(Object.values(vals)).size !== 3) throw new Error("세 코드는 서로 달라야 합니다");
        const K = await remoteJson(it.path + "keys.json");
        if (Number(K.adminV) >= 2) throw new Error("이 자료는 새 관리 방식으로 옮겨졌습니다");
        const admin = await V.ig1Admin(K, s.teacherKey);
        const nk = await V.ig1Keys(K, admin, vals);
        const back = await V.ig1Admin(nk, s.teacherKey);
        if (V.EDS.some((ed) => back.codes[ed] !== vals[ed])) throw new Error("새 열쇠 점검 실패");
        await commit({ [it.path + "keys.json"]: js(nk) }, `${it.title}: 접속 코드 변경(접속 코드 관리 화면)`);
        g.K = nk; g.admin = back; draw();
      });
      card.append(rows, el("div", { class: "row", style: "margin-top:8px" }, toggle), box);
      return card;
    }
    card.append(el("p", { class: "note", text: "이 화면이 모르는 자료 형식입니다." }));
    return card;
  }

  function adminCard() {
    const a = el("input", { type: "password", autocomplete: "new-password", placeholder: "새 관리자 코드(10자 이상)" });
    const b = el("input", { type: "password", autocomplete: "new-password", placeholder: "한 번 더" });
    const msg = el("p", { class: "msg", role: "status" });
    const save = el("button", { type: "button", on: { click: async () => {
      const bad = needToken() || (a.value.trim().length < 10 ? "관리자 코드는 10자 이상으로 정해 주세요." : a.value !== b.value ? "두 칸이 같지 않습니다." : "");
      if (bad) { msg.className = "msg"; msg.textContent = bad; return; }
      save.disabled = true; msg.className = "msg"; msg.textContent = "저장하는 중…(몇 초 걸립니다)";
      try {
        const rv = await sameVault();
        await V.setAdminCode(rv, st.pk8, a.value);
        await commit({ "codes/vault.json": vaultText(rv) }, "접속 코드 관리: 관리자 코드 변경");
        st.vault = rv; a.value = b.value = "";
        msg.className = "msg ok"; msg.textContent = DRY ? "(시험) 바뀔 파일을 만들었습니다." : "관리자 코드를 바꿨습니다. 1~2분 뒤부터 새 코드로 열립니다.";
      } catch (err) { msg.className = "msg"; msg.textContent = "저장하지 못했습니다: " + (err && err.message || err); }
      finally { save.disabled = false; }
    } } }, "관리자 코드 바꾸기");
    return el("section", { class: "card" }, el("h2", { text: "관리자 코드" }),
      el("p", { class: "note", text: "이 화면을 여는 코드입니다. 복구 키는 그대로이니, 관리자 코드를 잊으면 복구 키로 열어 여기서 새로 정하면 됩니다." }),
      a, el("div", { style: "height:8px" }), b, el("div", { class: "row", style: "margin-top:10px" }, save), msg);
  }

  function tokenCard() {
    const t = el("input", { type: "password", autocomplete: "off", placeholder: "github_pat_…" });
    const state = el("span", { class: "note", text: DRY ? "(시험 모드: 토큰 없이 파일만 만듭니다)" : "" });
    t.addEventListener("input", () => { st.token = t.value.trim(); state.textContent = st.token ? "토큰 입력됨(이 창 메모리에만)" : ""; });
    return el("section", { class: "card tok" },
      el("label", { class: "f", text: "GitHub 토큰 (코드를 바꿀 때만 필요)" }),
      el("div", { class: "row" }, t, el("button", { type: "button", class: "ghost", on: { click: () => { st = null; renderLock("잠갔습니다."); } } }, "잠그기")), state,
      el("p", { class: "note" }, "GitHub → Settings → Developer settings → Fine-grained tokens에서 저장소 ESCssaem.github.io만 고르고 권한 Contents: Read and write로 만듭니다. ",
        el("a", { href: "https://github.com/settings/personal-access-tokens/new", target: "_blank", rel: "noopener", text: "토큰 만들기 →" })));
  }

  // ── 방문자 카운터(escssaem-counter Worker) ──
  const NUM = (n) => Number(n || 0).toLocaleString("ko-KR");
  function statsCard() {
    const id = st.vault.order.find((x) => st.vault.items[x].kind === "stats");
    const card = el("section", { class: "card" }, el("h2", { text: "방문자" }));
    if (!id) { card.append(el("p", { class: "note", text: "카운터가 아직 연결되지 않았습니다." })); return card; }
    const body = el("div", {}, el("p", { class: "note", text: "불러오는 중…" }));
    const refresh = el("button", { type: "button", class: "ghost", on: { click: () => load() } }, "새로 고침");
    card.append(body, el("div", { class: "row", style: "margin-top:8px" }, refresh),
      el("p", { class: "note", text: "방문자: 그날 처음 연 브라우저 수(같은 기기·브라우저가 하루에 여러 번 열어도 1). 열람: 페이지를 연 횟수. 날짜는 한국 시간, IP 등 개인 정보는 저장하지 않습니다." }));
    async function load() {
      refresh.disabled = true;
      try {
        const s = st.secrets[id];
        const r = await fetch(s.api + "/stats", { headers: { Authorization: "Bearer " + s.token }, cache: "no-store" });
        if (!r.ok) throw new Error("카운터 응답 " + r.status);
        const d = await r.json();
        // 아직 기록이 없는 앱도 0으로 보여 준다(첫 화면 → 앱 목록 순서 → 명함)
        let names = {}, order = ["home"];
        try { const list = await fresh("../apps.json"); order.push(...list); await Promise.all(list.map(async (a) => { try { names[a] = (await fresh("../" + a + "/app.json")).title; } catch (_) {} })); } catch (_) {}
        names.home = "첫 화면"; names.card = "디지털 명함"; order.push("card");
        const got = Object.fromEntries(d.apps.map((a) => [a.app, a]));
        d.apps = [...order.map((app) => got[app] || { app }), ...d.apps.filter((a) => !order.includes(a.app))];
        const cols = [["today", "오늘"], ["week", "7일"], ["month", "30일"], ["total", "전체"]];
        const sum = { app: "합계" };
        for (const [k] of cols) for (const t of ["visitors", "views"]) sum[k + "_" + t] = d.apps.reduce((n, a) => n + (a[k + "_" + t] || 0), 0);
        const cell = (a, k) => el("td", {}, el("b", { text: NUM(a[k + "_visitors"]) }), el("small", { text: " / " + NUM(a[k + "_views"]) }));
        const row = (a, label, strong) => el("tr", strong ? { class: "sum" } : {}, el("th", { text: label }), ...cols.map(([k]) => cell(a, k)));
        body.replaceChildren(el("div", { class: "stats" }, el("table", {},
          el("thead", {}, el("tr", {}, el("th", { text: "앱" }), ...cols.map(([, t]) => el("th", { text: t })))),
          el("tbody", {}, ...d.apps.map((a) => row(a, names[a.app] || a.app)), row(sum, "합계", true)))),
          el("p", { class: "note", text: `칸마다 방문자 / 열람 · 기준일 ${d.today}` + (d.apps.some((a) => a.since) ? ` · 집계 시작 ${d.apps.map((a) => a.since).filter(Boolean).sort()[0]}` : " · 아직 기록 없음") }));
      } catch (err) { body.replaceChildren(el("p", { class: "msg", text: "불러오지 못했습니다: " + (err && err.message || err) })); }
      finally { refresh.disabled = false; }
    }
    load();
    return card;
  }

  function renderMain() {
    const items = st.vault.order.filter((id) => st.vault.items[id].kind !== "stats");
    app.replaceChildren(tokenCard(), statsCard(), ...items.map(itemCard), adminCard());
  }

  renderLock();
})();
