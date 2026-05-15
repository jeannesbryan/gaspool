import { Hono } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'
import { sign } from 'hono/jwt'
import * as bcrypt from 'bcryptjs'
import { Bindings } from '../index'

const auth = new Hono<{ Bindings: Bindings }>()

auth.get('/login', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
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
                    <input type="password" name="password" required>
                </div>
                
                <div class="turnstile-box">
                    <div class="cf-turnstile" data-sitekey="${c.env.TURNSTILE_SITE_KEY}" data-theme="dark"></div>
                </div>

                <button type="submit" class="btn">MASUK MARKAS</button>
            </form>
        </div>
    </body>
    </html>
  `)
})

auth.post('/login', async (c) => {
  const body = await c.req.parseBody()
  const email = body['email'] as string
  const password = body['password'] as string
  const turnstileResponse = body['cf-turnstile-response'] as string

  // 🛡️ VERIFIKASI TURNSTILE KE SERVER CLOUDFLARE
  if (!turnstileResponse) {
      return c.html('<div style="text-align:center; padding-top:50px; color:white; background:#0a0a12; height:100vh;"><h3>Validasi keamanan wajib diisi!</h3><a href="/login" style="color:#FF5F00;">Kembali</a></div>')
  }

  const formData = new FormData()
  formData.append('secret', c.env.TURNSTILE_SECRET_KEY)
  formData.append('response', turnstileResponse)

  const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData
  })
  const verifyOutcome: any = await verifyRes.json()

  if (!verifyOutcome.success) {
      return c.html('<div style="text-align:center; padding-top:50px; color:white; background:#0a0a12; height:100vh;"><h3>Deteksi Bot: Akses Ditolak! 🤖🚫</h3><a href="/login" style="color:#FF5F00;">Kembali</a></div>')
  }

  // 🔥 MAGIC AUTO-SETUP
  const count: any = await c.env.DB.prepare("SELECT COUNT(*) as total FROM users").first()
  if (count && count.total === 0) {
    const hashedPassword = bcrypt.hashSync(password, 10)
    await c.env.DB.prepare("INSERT INTO users (email, password) VALUES (?, ?)").bind(email, hashedPassword).run()
  }

  const user: any = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first()

  if (user && bcrypt.compareSync(password, user.password)) {
    const token = await sign({ 
        email: user.email, 
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7
    }, c.env.JWT_SECRET, 'HS256')
    
    setCookie(c, 'gaspool_session', token, { httpOnly: true, secure: true, sameSite: 'Strict' })
    return c.redirect('/')
  } else {
    return c.html(`
      <div style="text-align:center; font-family: sans-serif; background: #0a0a12; color: white; height: 100vh; padding-top: 100px;">
        <h3 style="color: #ff4444;">Akses Ditolak! Email atau Password salah.</h3>
        <a href="/login" style="color: #FF5F00; font-weight: bold; text-decoration: none;"><< KEMBALI</a>
      </div>
    `)
  }
})

auth.get('/logout', (c) => {
  deleteCookie(c, 'gaspool_session')
  return c.redirect('/login')
})

export default auth