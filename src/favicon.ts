/**
 * Tag favicon — satu sumber untuk semua halaman.
 *
 * Kenapa dipisah: halaman-halaman di aplikasi ini adalah template literal yang
 * masing-masing menulis <head>-nya sendiri, dan sebelumnya hanya SATU halaman
 * yang mendeklarasikan ikon sama sekali. Akibatnya favicon tidak muncul di
 * peramban untuk hampir seluruh aplikasi — bukan karena berkasnya hilang,
 * tetapi karena tidak ada halaman yang memberitahu peramban di mana mencarinya.
 *
 * Dua hal yang membuat ikon muncul dengan andal:
 *
 *   1. `/favicon.ico` tersedia di akar situs. Peramban meminta alamat itu
 *      sendiri, tanpa diminta, dan tidak semua peramban memakai <link> kalau
 *      alamat tersebut gagal.
 *   2. Ukuran kecil tetap dideklarasikan. Chrome memilih ikon untuk tab dari
 *      ukuran 16 atau 32; menyediakan hanya 192 dan 512 membuat sebagian
 *      peramban tidak menemukan yang cocok.
 *
 * Daftar di bawah karena itu memuat 16, 32, 192, dan 512, plus ikon sentuh
 * untuk iOS. Tag ini tidak boleh memakai backtick: semua pemakainya adalah
 * template literal, jadi backtick akan menutup template-nya.
 */
export const FAVICON_LINKS = [
  '<link rel="icon" href="/favicon.ico" sizes="any">',
  '<link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon-16x16.png">',
  '<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32x32.png">',
  '<link rel="icon" type="image/png" sizes="192x192" href="/assets/android-chrome-192x192.png">',
  '<link rel="icon" type="image/png" sizes="512x512" href="/assets/android-chrome-512x512.png">',
  '<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">',
].join("");
