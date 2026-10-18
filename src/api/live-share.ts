/**
 * Live broadcast for solo gowes: the token and its session record.
 *
 * Why a separate module: this token is the only thing stopping a stranger from
 * finding someone's location. /radar/<token> opens without a login, and in
 * Peleton mode the room name is chosen by its users, so names like "JEANNES"
 * or "GOWESJUMAT" can be guessed. Solo broadcasts therefore use a random token,
 * and the properties of that token (length, alphabet, uniqueness) are better
 * tested directly as pure functions than through HTTP.
 *
 * This module imports nothing so tests can load it via Node's TypeScript type
 * stripping (see tests/live-share.mjs).
 */

/**
 * Token alphabet.
 *
 * Two things decide its shape:
 *
 *   1. Exactly 32 characters, so the 256 byte values divide evenly and there is
 *      no modulo bias. An alphabet whose size is not a divisor of 256 makes the
 *      early letters show up more often than the last one, which means the
 *      token is easier to guess than its length promises.
 *   2. No I and no O. Both are easily confused with 1 and 0 when a token is
 *      read out over the phone or copied from someone else's screen.
 *
 * 32 characters x 16 tokens = 80 bit.
 */
export const LIVE_SHARE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const LIVE_SHARE_TOKEN_LENGTH = 16;

/** A session lives for the whole gowes day, not just while one position is valid. */
export const LIVE_SHARE_SESSION_TTL_SECONDS = 24 * 60 * 60;

/**
 * Session record key in KV.
 *
 * Participant positions are stored as `<ROOM>:<USER>`, and `sanitizeRoomId`
 * only lets A-Z, 0-9, "_" and "-" through. The "~" character can never show up
 * there, so a session record will never collide with a participant position,
 * including when somebody names their room "LIVE".
 */
export const liveSessionKey = (token: string) => `live:~${String(token || "").toUpperCase()}`;

/**
 * Shape of a token considered valid. The client uses it to decide whether the
 * value in localStorage is still worth using, which is why it is exported.
 */
export const LIVE_SHARE_TOKEN_PATTERN = /^[A-Z0-9]{16}$/;

export type LiveSession = {
  user: string;
  started_ms: number;
};

/** Create one broadcast token. The randomness comes from the platform CSPRNG. */
export const createLiveShareToken = () => {
  const bytes = new Uint8Array(LIVE_SHARE_TOKEN_LENGTH);
  crypto.getRandomValues(bytes);

  let token = "";
  for (const byte of bytes) {
    token += LIVE_SHARE_ALPHABET[byte % LIVE_SHARE_ALPHABET.length];
  }

  return token;
};

/** A plain guard for KV so a corrupted value cannot take down the request. */
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
 * The KV shape this module needs.
 *
 * Written as a structural type on purpose, not as Cloudflare's own KV type, so
 * the module can still be loaded by Node tests without a Worker. Written as
 * method declarations (not arrow properties) so parameters are checked
 * bivariantly and Cloudflare KVNamespace fits without needing `any`.
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
