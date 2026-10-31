// 방문자 카운터(escssaem-counter Worker). 앱 이름(첫 경로, 첫 화면은 home)만 보낸다.
// 같은 브라우저가 같은 날 다시 열면 열람 수만 늘고 방문자 수는 그대로다(그날 날짜만 이 브라우저에 기억).
// window.escCount(app): 다른 주소에서 도는 앱(갈림길 등)으로 바로 가는 링크를 누를 때 그 앱으로 센다.
(() => {
  const count = (app) => {
    try {
      if (location.hostname !== "escssaem.github.io" || !/^[a-z0-9-]{1,40}$/.test(app)) return;
      const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
      let first = true;
      try { const k = "esc-seen-" + app; if (localStorage.getItem(k) === day) first = false; else localStorage.setItem(k, day); } catch (_) {}
      fetch("https://escssaem-counter.escssaem.workers.dev/hit", {
        method: "POST", mode: "cors", keepalive: true, credentials: "omit",
        headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ app, v: first }),
      }).catch(() => {});
    } catch (_) {}
  };
  window.escCount = count;
  const seg = location.pathname.split("/").filter(Boolean)[0] || "home";
  count(/\.html?$/.test(seg) ? "home" : seg);
})();
