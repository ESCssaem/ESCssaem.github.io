// 방문자 카운터(escssaem-counter Worker). 앱 이름(첫 경로, 첫 화면은 home)만 보낸다.
// 같은 브라우저가 같은 날 다시 열면 열람 수만 늘고 방문자 수는 그대로다(그날 날짜만 이 브라우저에 기억).
(() => {
  try {
    if (location.hostname !== "escssaem.github.io") return;
    const seg = location.pathname.split("/").filter(Boolean)[0] || "home";
    const app = /\.html?$/.test(seg) ? "home" : seg;
    const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    let first = true;
    try { const k = "esc-seen-" + app; if (localStorage.getItem(k) === day) first = false; else localStorage.setItem(k, day); } catch (_) {}
    fetch("https://escssaem-counter.escssaem.workers.dev/hit", {
      method: "POST", mode: "cors", keepalive: true, credentials: "omit",
      headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ app, v: first }),
    }).catch(() => {});
  } catch (_) {}
})();
