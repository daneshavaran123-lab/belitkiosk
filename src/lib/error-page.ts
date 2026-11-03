export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="fa" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <title>این صفحه باز نشد</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      * { box-sizing: border-box; }
      body { font: 18px/1.8 "Vazirmatn", system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif; color: #fff; margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 1.5rem;
        background: radial-gradient(60vmax 60vmax at 15% 0%, rgba(235,150,60,.35), transparent 60%), radial-gradient(60vmax 60vmax at 90% 100%, rgba(40,130,170,.35), transparent 60%), #03080f; }
      .card { max-width: 30rem; width: 100%; text-align: center; padding: 2.5rem 2rem; border-radius: 2rem;
        background: linear-gradient(180deg, rgba(255,255,255,.16), rgba(255,255,255,0) 40%), rgba(20,30,46,.55);
        -webkit-backdrop-filter: blur(26px) saturate(1.7); backdrop-filter: blur(26px) saturate(1.7);
        border: 1px solid rgba(255,255,255,.2); box-shadow: inset 1px 1.5px 0 rgba(255,255,255,.45), 0 30px 70px -20px rgba(0,0,0,.7); }
      h1 { font-size: 1.6rem; margin: 0 0 .5rem; background: linear-gradient(180deg,#fff0d2,#f3c98e 40%,#cd7f32); -webkit-background-clip: text; background-clip: text; color: transparent; }
      p { color: rgba(255,255,255,.75); margin: 0 0 1.75rem; }
      .actions { display: flex; gap: .75rem; justify-content: center; flex-wrap: wrap; }
      a, button { min-height: 3.25rem; padding: 0 1.75rem; border-radius: 999px; font: inherit; font-weight: 800; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; border: 1px solid rgba(255,255,255,.25); }
      .primary { background: linear-gradient(180deg, rgba(255,255,255,.5), rgba(255,255,255,0) 46%), linear-gradient(135deg,#f7d9a4,#e0a057 40%,#c4782b 75%,#9a5a1c); color: #2a1606; border-color: rgba(255,226,180,.7); }
      .secondary { background: rgba(255,255,255,.12); color: #fff; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>این صفحه باز نشد</h1>
      <p>مشکلی پیش آمد. دوباره امتحان کنید یا به صفحهٔ اصلی برگردید.</p>
      <div class="actions">
        <button class="primary" onclick="location.reload()">تلاش دوباره</button>
        <a class="secondary" href="/">صفحهٔ اصلی</a>
      </div>
    </div>
  </body>
</html>`;
}
