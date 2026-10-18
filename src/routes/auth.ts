import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { sign } from "hono/jwt";
import * as bcrypt from "bcryptjs";
import { Bindings } from "../index";
import { FAVICON_LINKS } from "../favicon";

const auth = new Hono<{ Bindings: Bindings }>();

auth.get("/login", (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
      ${FAVICON_LINKS}
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Login - Gaspool</title>
        <link rel="manifest" href="/manifest.json">
        <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
        <style>
            :root { --primary: #FF5F00; --bg: #0a0a12; --card: rgba(255, 255, 255, 0.05); }
            * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
            body { 
                font-family: 'Inter', sans-serif; 
                background: var(--bg); 
                background-image: radial-gradient(circle at 50% 0%, #1e1b4b 0%, #0a0a12 80%); 
                color: #fff; 
                margin: 0; 
                display: flex; 
                align-items: center; 
                justify-content: center; 
                min-height: 100vh; 
            }
            .login-card { 
                width: 100%; 
                max-width: 400px; 
                padding: 40px 30px; 
                background: var(--card); 
                backdrop-filter: blur(20px); 
                border-radius: 30px; 
                border: 1px solid rgba(255,255,255,0.1); 
                text-align: center; 
                box-shadow: 0 25px 50px rgba(0,0,0,0.5); 
            }
            .logo-box h1 { 
                font-size: 2.2rem; 
                font-weight: 900; 
                font-style: italic; 
                letter-spacing: -2px; 
                margin: 0 0 30px 0; 
                color: var(--primary); 
            }
            .form-group { text-align: left; margin-bottom: 20px; }
            label { 
                display: block; 
                font-size: 0.7rem; 
                color: var(--primary); 
                font-weight: 800; 
                margin-bottom: 8px; 
                letter-spacing: 1px; 
            }
            input { 
                width: 100%; 
                padding: 15px; 
                border-radius: 12px; 
                border: 1px solid #333; 
                background: #000; 
                color: #fff; 
                font-size: 1rem; 
                outline: none; 
                transition: 0.3s; 
            }
            input:focus { border-color: var(--primary); box-shadow: 0 0 15px rgba(255, 95, 0, 0.2); }
            .btn { 
                width: 100%; 
                padding: 18px; 
                border-radius: 12px; 
                border: none; 
                background: var(--primary); 
                color: #fff; 
                font-size: 1.1rem; 
                font-weight: 900; 
                cursor: pointer; 
                text-transform: uppercase; 
                font-style: italic; 
                transition: 0.3s; 
            }
            .btn:active { transform: scale(0.98); }
            .turnstile-box { margin-bottom: 20px; display: flex; justify-content: center; }
            /* Password wrapper: the input and the eye button share one row. */
            .password-wrap { position: relative; display: block; }
            .password-wrap input { padding-right: 54px; }
            .password-toggle {
                position: absolute;
                top: 50%;
                right: 8px;
                transform: translateY(-50%);
                /* 44px: same as the tracker button's touch target standard. */
                width: 44px;
                height: 44px;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 0;
                border: 0;
                border-radius: 10px;
                background: transparent;
                color: var(--primary);
                cursor: pointer;
                line-height: 1;
            }
            .password-toggle:hover { background: rgba(255,95,0,0.12); }
            .password-toggle:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
            .password-toggle svg { width: 22px; height: 22px; display: block; }
        </style>
    </head>
    <body>
        <div class="login-card">
            <div class="logo-box"><h1>GASPOOL</h1></div>
            <form method="POST" action="/login">
                <div class="form-group">
                    <label>EMAIL KAPTEN</label>
                    <input type="email" name="email" required autocomplete="off">
                </div>
                <div class="form-group">
                    <label>KATA SANDI</label>
                    <span class="password-wrap">
                        <input type="password" name="password" id="login-password" required autocomplete="current-password">
                        <button type="button" class="password-toggle" id="password-toggle"
                                aria-controls="login-password" aria-pressed="false"
                                aria-label="Tampilkan kata sandi" title="Tampilkan kata sandi">
                            <span id="password-toggle-icon" aria-hidden="true"></span>
                        </button>
                    </span>
                </div>
                
                <div class="turnstile-box">
                    <div class="cf-turnstile" data-sitekey="${c.env.TURNSTILE_SITE_KEY}" data-theme="dark"></div>
                </div>

                <button type="submit" class="btn">MASUK MARKAS</button>
            </form>
        </div>
        <script>
            // Eye button: shows / hides the password.
            // The icons are drawn as inline SVG so no extra file is needed,
            // and aria-pressed is flipped so screen readers know the state too.
            (function () {
                var input = document.getElementById('login-password');
                var toggle = document.getElementById('password-toggle');
                var icon = document.getElementById('password-toggle-icon');
                if (!input || !toggle || !icon) return;

                var EYE_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
                var EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a19.8 19.8 0 0 1 5.06-5.94"/><path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a19.9 19.9 0 0 1-3.17 4.19"/><path d="M9.88 9.88A3 3 0 0 0 12 15a3 3 0 0 0 2.12-.88"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

                function render(visible) {
                    icon.innerHTML = visible ? EYE_OFF : EYE_OPEN;
                    toggle.setAttribute('aria-pressed', visible ? 'true' : 'false');
                    var label = visible ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi';
                    toggle.setAttribute('aria-label', label);
                    toggle.setAttribute('title', label);
                }

                render(false);

                toggle.addEventListener('click', function () {
                    var show = input.type === 'password';
                    // Focus stays in the password field after the click so the caret
                    // does not jump around while the user is typing.
                    input.setAttribute('type', show ? 'text' : 'password');
                    render(show);
                    input.focus();
                });
            })();
        </script>
    </body>
    </html>
  `);
});

// ==========================================
// LOGIN ATTEMPT LIMITER (BRUTE-FORCE)
// ==========================================
// The `login_logs` table has existed in the schema from the start but was never used,
// so nothing limited password attempts. The value is stored per
// IP address with a time window, not a lifetime counter, so an owner
// who mistypes is not locked out permanently.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;

const getClientIp = (c: any) => {
  const header =
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-forwarded-for") ||
    c.req.header("x-real-ip") ||
    "";
  return String(header).split(",")[0].trim() || "unknown";
};

const countRecentAttempts = async (db: D1Database, ip: string) => {
  try {
    const row: any = await db
      .prepare("SELECT attempts, last_attempt FROM login_logs WHERE ip_address = ?")
      .bind(ip)
      .first();

    if (!row) return 0;

    const lastAttempt = Number(row.last_attempt || 0);
    // The window has passed: the old count is no longer relevant.
    if (!lastAttempt || Date.now() - lastAttempt > LOGIN_WINDOW_MS) return 0;

    return Number(row.attempts || 0);
  } catch (error) {
    // If the table cannot be read, login is still served. Blocking login
    // because of a database fault would lock the owner out of their own app.
    console.warn("Login rate limit tidak bisa dibaca:", error);
    return 0;
  }
};

const recordFailedAttempt = async (db: D1Database, ip: string) => {
  const now = Date.now();

  try {
    const row: any = await db
      .prepare("SELECT attempts, last_attempt FROM login_logs WHERE ip_address = ?")
      .bind(ip)
      .first();

    const lastAttempt = Number(row?.last_attempt || 0);
    const withinWindow = lastAttempt && now - lastAttempt <= LOGIN_WINDOW_MS;
    const attempts = withinWindow ? Number(row?.attempts || 0) + 1 : 1;

    await db
      .prepare(
        `INSERT INTO login_logs (ip_address, attempts, last_attempt) VALUES (?, ?, ?)
         ON CONFLICT(ip_address) DO UPDATE SET attempts = excluded.attempts, last_attempt = excluded.last_attempt`,
      )
      .bind(ip, attempts, now)
      .run();
  } catch (error) {
    console.warn("Login rate limit tidak bisa dicatat:", error);
  }
};

const clearAttempts = async (db: D1Database, ip: string) => {
  try {
    await db.prepare("DELETE FROM login_logs WHERE ip_address = ?").bind(ip).run();
  } catch (error) {
    console.warn("Login rate limit tidak bisa dibersihkan:", error);
  }
};

const renderLockedPage = (remainingMinutes: number) => `
          <div style="text-align:center; font-family: sans-serif; background: #0a0a12; color: white; height: 100vh; padding-top: 100px;">
            <h3 style="color: #ff4444;">Terlalu banyak percobaan login.</h3>
            <p style="color: #cbd5e1;">Coba lagi sekitar ${remainingMinutes} menit lagi.</p>
            <a href="/login" style="color: #FF5F00; font-weight: bold; text-decoration: none;">&lt;&lt; KEMBALI</a>
          </div>
        `;

auth.post("/login", async (c) => {
  const body = await c.req.parseBody();
  const email = ((body["email"] as string) || "").trim().toLowerCase();
  const password = body["password"] as string;
  const turnstileResponse = body["cf-turnstile-response"] as string;
  const clientIp = getClientIp(c);

  // Checked before Turnstile and bcrypt: both are expensive, and that is exactly
  // what an attacker is after. An existing counter stays in force while its window
  // has not passed, so the 9th attempt onward never touches either of them.
  const previousAttempts = await countRecentAttempts(c.env.DB, clientIp);

  if (previousAttempts >= LOGIN_MAX_ATTEMPTS) {
    return c.html(renderLockedPage(Math.ceil(LOGIN_WINDOW_MS / 60000)), 429);
  }

  // 🛡️ VERIFY TURNSTILE WITH THE CLOUDFLARE SERVER
  if (!turnstileResponse) {
    return c.html(
      '<div style="text-align:center; padding-top:50px; color:white; background:#0a0a12; height:100vh;"><h3>Validasi keamanan wajib diisi!</h3><a href="/login" style="color:#FF5F00;">Kembali</a></div>',
    );
  }

  try {
    const formData = new FormData();
    formData.append("secret", c.env.TURNSTILE_SECRET_KEY);
    formData.append("response", turnstileResponse);

    const verifyRes = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: formData,
      },
    );
    const verifyOutcome: any = await verifyRes.json();

    if (!verifyOutcome.success) {
      return c.html(
        '<div style="text-align:center; padding-top:50px; color:white; background:#0a0a12; height:100vh;"><h3>Deteksi Bot: Akses Ditolak! 🤖🚫</h3><a href="/login" style="color:#FF5F00;">Kembali</a></div>',
      );
    }

    // 🔥 MAGIC AUTO-SETUP
    const count: any = await c.env.DB.prepare(
      "SELECT COUNT(*) as total FROM users",
    ).first();
    if (count && count.total === 0) {
      // CHANGE: use an async function (await) so the Cloudflare CPU does not hang
      const hashedPassword = await bcrypt.hash(password, 10);
      await c.env.DB.prepare(
        "INSERT INTO users (email, password) VALUES (?, ?)",
      )
        .bind(email, hashedPassword)
        .run();
    }

    const user: any = await c.env.DB.prepare(
      "SELECT * FROM users WHERE email = ?",
    )
      .bind(email)
      .first();

    // CHANGE: use an async function (await) for the password comparison
    if (user && (await bcrypt.compare(password, user.password))) {
      const token = await sign(
        {
          email: user.email,
          exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
        },
        c.env.JWT_SECRET,
        "HS256",
      );

      setCookie(c, "gaspool_session", token, {
        httpOnly: true,
        secure: true,
        sameSite: "Strict",
        maxAge: 60 * 60 * 24 * 7,
        path: "/",
      });
      // A valid login clears the counter: an owner who mistyped earlier
      // does not carry leftover attempt quota into the next session.
      await clearAttempts(c.env.DB, clientIp);
      return c.redirect("/");
    } else {
      // Only credential failures are counted. A Turnstile failure is already
      // handled as a bot gate, and counting it could lock the owner
      // out just because the widget failed to load.
      await recordFailedAttempt(c.env.DB, clientIp);
      return c.html(`
          <div style="text-align:center; font-family: sans-serif; background: #0a0a12; color: white; height: 100vh; padding-top: 100px;">
            <h3 style="color: #ff4444;">Akses Ditolak! Email atau Password salah.</h3>
            <a href="/login" style="color: #FF5F00; font-weight: bold; text-decoration: none;"><< KEMBALI</a>
          </div>
        `);
    }
  } catch (error) {
    console.error("Login Error:", error);
    return c.html(
      '<div style="text-align:center; padding-top:50px; color:white; background:#0a0a12; height:100vh;"><h3>Terjadi kesalahan pada server. Silakan coba lagi.</h3><a href="/login" style="color:#FF5F00;">Kembali</a></div>',
    );
  }
});

auth.get("/logout", (c) => {
  deleteCookie(c, "gaspool_session", {
    path: "/",
  });

  return c.redirect("/login");
});

export default auth;
