import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { csrf } from 'hono/csrf'
import { Bindings } from '../index'

const api = new Hono<{ Bindings: Bindings }>()

// ==========================================
// MIDDLEWARE PERTAHANAN API
// ==========================================
// Perisai Anti-CSRF: Mencegah serangan pemalsuan permintaan silang.
// Memastikan aksi POST/DELETE murni dikirim dari dalam markas Gaspool.
api.use('*', csrf())

// Middleware untuk mem-proteksi API (hanya Kapten yang bisa Save, Edit, Delete)
const protectAPI = async (c: any, next: any) => {
  const token = getCookie(c, 'gaspool_session')
  if (!token) return c.json({ success: false, message: 'Unauthorized' }, 401)
  await next()
}

// 1. Tarik Data Dashboard
api.get('/rides', protectAPI, async (c) => {
  const f = c.req.query('filter') || 'all'
  const p = parseInt(c.req.query('page') || '1')
  const lim = 10
  const off = (p - 1) * lim

  let qStats = "SELECT COUNT(*) as total_count, COALESCE(SUM(distance),0) as total_dist, COALESCE(SUM(moving_time),0) as total_time, COALESCE(SUM(total_elevation_gain),0) as total_elev FROM rides"
  let qData = "SELECT * FROM rides"
  
  if (f !== 'all') { 
      qStats += " WHERE activity_type = ?"
      qData += " WHERE activity_type = ?" 
  }
  qData += " ORDER BY start_date DESC LIMIT ? OFFSET ?"
  
  try {
      const stats = f === 'all' ? await c.env.DB.prepare(qStats).first() : await c.env.DB.prepare(qStats).bind(f).first()
      const rides = f === 'all' ? await c.env.DB.prepare(qData).bind(lim, off).all() : await c.env.DB.prepare(qData).bind(f, lim, off).all()
      return c.json({ stats, rides: rides.results })
  } catch (e) {
      return c.json({ error: 'Database error' }, 500)
  }
})

// 2. Simpan Rekaman Baru (Save Ride) ke R2 dan D1
api.post('/save_ride', protectAPI, async (c) => {
  try {
      const b = await c.req.json()
      if (!b.polyline || b.polyline.length === 0) return c.json({ success: false, message: "Rute kosong!" }, 400)

      let avgSpeed = 0
      if (b.duration > 0 && b.distance > 0) avgSpeed = b.distance / (b.duration / 3600)

      const fileName = `gaspool_ride_${Date.now()}_${Math.floor(Math.random() * 1000)}.json`
      
      // Upload Array ke R2
      await c.env.R2_BUCKET.put(fileName, JSON.stringify(b.polyline), { httpMetadata: { contentType: 'application/json' } })
      
      // URL TELAH DISANITASI
      const publicUrl = `https://YOUR_R2_PUBLIC_URL_HERE.r2.dev/${fileName}`

      // Masukkan meta ke D1
      const query = `INSERT INTO rides (name, distance, moving_time, average_speed, max_speed, total_elevation_gain, avg_temp, participants, start_date, polyline, activity_type, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      await c.env.DB.prepare(query).bind(
          b.name, b.distance || 0, b.duration || 0, avgSpeed, b.max_speed || 0, b.total_elevation_gain || 0, b.avg_temp || 0,
          b.participants ? JSON.stringify(b.participants) : '[]',
          b.start_date || new Date().toISOString(), publicUrl, b.activity_type || 'ride', b.source || 'GASPOOL'
      ).run()

      return c.json({ success: true, message: "Data mendarat di awan!" })
  } catch (e: any) {
      return c.json({ success: false, message: e.message }, 500)
  }
})

// 3. Edit Judul Aktivitas
api.post('/edit_ride/:id', protectAPI, async (c) => {
  const { name } = await c.req.json()
  await c.env.DB.prepare("UPDATE rides SET name = ? WHERE id = ?").bind(name, c.req.param('id')).run()
  return c.json({ success: true })
})

// 4. Hapus Aktivitas
api.delete('/delete_ride/:id', protectAPI, async (c) => {
  await c.env.DB.prepare("DELETE FROM rides WHERE id = ?").bind(c.req.param('id')).run()
  return c.json({ success: true })
})

// 5. RADAR SYNC (Cloudflare KV) - Terbuka untuk Tamu (Bebas Token)
api.post('/radar_sync', async (c) => {
  try {
      const { room, user, lat, lng, speed } = await c.req.json()
      if(!room || !user || room === 'SINGLE_MODE') return c.json({ success: true, participants: [], radios: [] })
      
      // Simpan koordinat lokasi ke Radar
      await c.env.GASPOOL_RADAR.put(`${room}:${user}`, JSON.stringify({ lat, lng, speed, time: Date.now() }), { expirationTtl: 60 })
      
      // Ambil daftar teman satu room
      const list = await c.env.GASPOOL_RADAR.list({ prefix: room + ':' })
      const participants = await Promise.all(list.keys.map(async k => {
          const val = await c.env.GASPOOL_RADAR.get(k.name)
          return { user: k.name.split(':')[1], ...JSON.parse(val || '{}') }
      }))

      // Telinga Satelit: Dengarkan apakah ada file radio (suara) baru di room ini
      const radioList = await c.env.GASPOOL_RADAR.list({ prefix: `RADIO:${room}:` })
      const radios = await Promise.all(radioList.keys.map(async k => {
          const val = await c.env.GASPOOL_RADAR.get(k.name)
          return { user: k.name.split(':')[2], ...JSON.parse(val || '{}') }
      }))
      
      return c.json({ success: true, participants, radios })
  } catch (e) {
      return c.json({ success: false }, 500)
  }
})

// 6. RADIO PTT (Voice Sync) - REAL R2 & KV UPLOAD
api.post('/radio', async (c) => {
  try {
      const body = await c.req.parseBody()
      const room = body['room'] as string
      const user = body['user'] as string
      const audioFile = body['audio'] as File

      if (!room || !user || !audioFile) {
          return c.json({ success: false, message: 'Data transmisi tidak lengkap' }, 400)
      }

      // Generate nama file unik agar tidak bertabrakan
      const fileName = `radio_${room}_${user.replace(/[^a-zA-Z0-9]/g, '')}_${Date.now()}.webm`
      
      // Konversi file suara menjadi ArrayBuffer untuk diunggah
      const arrayBuffer = await audioFile.arrayBuffer()

      // Tembakkan file suara ke Satelit R2
      await c.env.R2_BUCKET.put(fileName, arrayBuffer, { 
          httpMetadata: { contentType: audioFile.type || 'audio/webm' } 
      })
      
      // URL TELAH DISANITASI
      const publicUrl = `https://YOUR_R2_PUBLIC_URL_HERE.r2.dev/${fileName}`

      // Catat link suara ke Radar KV agar teman di room bisa mendengarnya
      await c.env.GASPOOL_RADAR.put(`RADIO:${room}:${user}`, JSON.stringify({
          url: publicUrl,
          time: Date.now()
      }), { expirationTtl: 60 })

      return c.json({ success: true, url: publicUrl })
  } catch (e: any) {
      return c.json({ success: false, message: e.message }, 500)
  }
})

// 7. PUBLIC RIDES FETCH (Hanya untuk Pemilik Repo)
api.get('/public_rides/:username', async (c) => {
  const username = c.req.param('username').toLowerCase()
  const p = parseInt(c.req.query('page') || '1')
  const lim = 10
  const off = (p - 1) * lim

  // USERNAME TELAH DISANITASI
  if (username !== 'YOUR_USERNAME_HERE') return c.json({ error: 'Unauthorized' }, 401)

  try {
      const { results: rides } = await c.env.DB.prepare("SELECT * FROM rides ORDER BY start_date DESC LIMIT ? OFFSET ?")
                                .bind(lim, off).all()
      return c.json({ rides })
  } catch (e) {
      return c.json({ error: 'Database error' }, 500)
  }
})

// 8. RADAR SPECTATOR (Hanya Membaca Data Peleton untuk Keluarga)
api.get('/radar_view/:room', async (c) => {
  const room = c.req.param('room').toUpperCase()
  try {
      const list = await c.env.GASPOOL_RADAR.list({ prefix: room + ':' })
      const participants = await Promise.all(list.keys.map(async k => {
          const val = await c.env.GASPOOL_RADAR.get(k.name)
          return { user: k.name.split(':')[1], ...JSON.parse(val || '{}') }
      }))
      return c.json({ success: true, participants })
  } catch (e) {
      return c.json({ success: false }, 500)
  }
})

// 9. SATELIT CUACA (Open-Meteo Proxy)
api.get('/weather', async (c) => {
  const lat = c.req.query('lat')
  const lng = c.req.query('lng')
  if (!lat || !lng) return c.json({ temp: null })
  
  try {
      const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true`)
      const data: any = await res.json()
      return c.json({ temp: data.current_weather?.temperature || null })
  } catch (e) {
      return c.json({ temp: null })
  }
})

export default api