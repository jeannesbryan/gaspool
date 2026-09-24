/**
 * Siaran live untuk gowes solo — token dan catatan sesinya.
 *
 * Kenapa modul terpisah: token ini adalah satu-satunya yang menghalangi orang
 * asing menemukan lokasi seseorang. /radar/<token> bisa dibuka tanpa login, dan
 * di mode Peleton nama room dipilih sendiri oleh pemakainya sehingga nama
 * seperti "JEANNES" atau "GOWESJUMAT" bisa ditebak. Karena itu siaran solo
 * memakai token acak, dan sifat-sifat token itu (panjang, alfabet, keunikan)
 * lebih baik diuji langsung sebagai fungsi murni daripada lewat HTTP.
 *
 * Modul ini tidak mengimpor apa pun supaya test bisa memuatnya lewat
 * TypeScript type stripping Node (lihat tests/live-share.mjs).
 */

/**
 * Alfabet token.
 *
 * Dua hal yang menentukan bentuknya:
 *
 *   1. Tepat 32 karakter, sehingga 256 nilai byte terbagi rata dan tidak ada
 *      modulo bias. Alfabet berukuran bukan-pembagi-256 akan membuat huruf awal
 *      lebih sering muncul daripada yang terakhir, yang berarti token lebih
 *      mudah ditebak daripada yang dijanjikan panjangnya.
 *   2. Tanpa I dan O. Keduanya mudah tertukar dengan 1 dan 0 ketika token
 *      dibacakan lewat telepon atau disalin dari layar orang lain.
 *
 * 32 karakter x 16 token = 80 bit.
 */
export const LIVE_SHARE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const LIVE_SHARE_TOKEN_LENGTH = 16;

/** Sesi hidup sepanjang hari gowes, bukan hanya selama satu posisi berlaku. */
export const LIVE_SHARE_SESSION_TTL_SECONDS = 24 * 60 * 60;

/**
 * Kunci catatan sesi di KV.
 *
 * Posisi peserta disimpan sebagai `<ROOM>:<USER>`, dan `sanitizeRoomId` hanya
 * meloloskan A-Z, 0-9, "_" dan "-". Karakter "~" tidak mungkin muncul di sana,
 * jadi catatan sesi tidak akan pernah bertabrakan dengan posisi peserta —
 * termasuk kalau ada yang menamai room-nya "LIVE".
 */
export const liveSessionKey = (token: string) => `live:~${String(token || "").toUpperCase()}`;

/**
 * Bentuk token yang dianggap sah. Dipakai di sisi klien untuk memutuskan apakah
 * nilai di localStorage masih layak dipakai, jadi sengaja diekspor.
 */
export const LIVE_SHARE_TOKEN_PATTERN = /^[A-Z0-9]{16}$/;

export type LiveSession = {
  user: string;
  started_ms: number;
};

/** Buat satu token siaran. Sumber acaknya CSPRNG platform. */
export const createLiveShareToken = () => {
  const bytes = new Uint8Array(LIVE_SHARE_TOKEN_LENGTH);
  crypto.getRandomValues(bytes);

  let token = "";
  for (const byte of bytes) {
    token += LIVE_SHARE_ALPHABET[byte % LIVE_SHARE_ALPHABET.length];
  }

  return token;
};

/** Batas sederhana untuk KV agar nilai yang rusak tidak menjatuhkan request. */
const parseSession = (raw: string | null): LiveSession | null => {
  try {
    const parsed = JSON.parse(raw || "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    return {
      user: String(parsed.user || ""),
      started_ms: Number(parsed.started_ms || 0),
    };
  } catch {
    return null;
  }
};

/**
 * Bentuk KV yang dibutuhkan modul ini.
 *
 * Sengaja ditulis sebagai tipe struktural, bukan tipe KV milik Cloudflare,
 * supaya modul tetap bisa dimuat test Node tanpa Worker. Ditulis sebagai
 * deklarasi method (bukan properti panah) agar parameter diperiksa secara
 * bivarian dan Cloudflare KVNamespace cocok tanpa perlu `any`.
 */
export type LiveShareKv = {
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<unknown>;
  get(key: string): Promise<string | null>;
};

export const saveLiveSession = async (kv: LiveShareKv, token: string, user: string) => {
  await kv.put(
    liveSessionKey(token),
    JSON.stringify({ user, started_ms: Date.now() } satisfies LiveSession),
    { expirationTtl: LIVE_SHARE_SESSION_TTL_SECONDS },
  );
};

export const readLiveSession = async (
  kv: LiveShareKv,
  token: string,
): Promise<LiveSession | null> => {
  try {
    return parseSession(await kv.get(liveSessionKey(token)));
  } catch {
    return null;
  }
};
