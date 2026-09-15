/**
 * Konfigurasi yang bergantung pada deployment.
 *
 * Nilai-nilai di sini punya default agar deployment yang sudah berjalan tidak
 * berubah perilakunya, tetapi semuanya bisa (dan sebaiknya) diatur lewat `vars`
 * di wrangler.jsonc supaya instance milik orang lain tidak menunjuk ke resource
 * milik pengembang aslinya.
 */

const DEFAULT_R2_PUBLIC_BASE_URL =
  "https://pub-13cc00374110455e9437c511bcbdf007.r2.dev";

type PublicUrlEnv = { R2_PUBLIC_BASE_URL?: string };

/**
 * Basis URL publik bucket R2, tempat file rute JSON dan rekaman radio disajikan.
 *
 * Setel `R2_PUBLIC_BASE_URL` ke domain publik bucket milikmu sendiri. Kalau
 * dibiarkan kosong, nilainya jatuh ke default pengembang dan tautan berkas akan
 * menunjuk ke bucket yang salah.
 */
export const getR2PublicBaseUrl = (env?: PublicUrlEnv) => {
  const configured = String(env?.R2_PUBLIC_BASE_URL || "").trim();
  return (configured || DEFAULT_R2_PUBLIC_BASE_URL).replace(/\/+$/, "");
};

/** Hostname saja, dipakai saat membandingkan asal sebuah polyline. */
export const getR2PublicHostname = (env?: PublicUrlEnv) => {
  try {
    return new URL(getR2PublicBaseUrl(env)).hostname;
  } catch {
    return "";
  }
};
