/**
 * Uji modul pemberitahuan peta (public/assets/map-notice.js).
 *
 * Kenapa uji ini ada. Semua peta jejak di Gaspool mengambil titiknya dari objek
 * R2 lewat fetch() di sisi klien. Selama ini, kalau fetch itu gagal, halaman
 * hanya menulis console.error dan petanya tinggal kosong — dari sisi pemakai
 * tidak bisa dibedakan dari "aplikasinya rusak". Aturan repo ini: jangan pernah
 * diam. Uji ini menjaga pesannya tetap ada, tetap menyebut sebab yang paling
 * sering, dan tetap menyebut bahwa angka aktivitasnya tidak hilang.
 *
 *   node tests/map-notice.mjs
 *
 * Murni Node, tanpa Worker/D1/network: DOM-nya tiruan kecil.
 */
import "../public/assets/map-notice.js";

const MapNotice = globalThis.MapNotice;

const results = [];
const check = (name, passed, detail) => {
  results.push({ name, passed: Boolean(passed), detail });
};
const checkEqual = (name, actual, expected) =>
  check(name, Object.is(actual, expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

/** DOM tiruan: cukup untuk fungsi yang kita pakai, tanpa jsdom. */
function makeDoc() {
  const doc = {
    _byId: {},
    createElement(tag) {
      const el = {
        tagName: String(tag).toUpperCase(),
        style: {},
        attributes: {},
        children: [],
        parentNode: null,
        _text: "",
        set textContent(value) {
          this._text = String(value);
        },
        get textContent() {
          return this._text;
        },
        setAttribute(key, value) {
          this.attributes[key] = String(value);
        },
        getAttribute(key) {
          return this.attributes[key] === undefined ? null : this.attributes[key];
        },
        appendChild(child) {
          child.parentNode = this;
          this.children.push(child);
          return child;
        },
        removeChild(child) {
          const index = this.children.indexOf(child);
          if (index >= 0) {
            this.children.splice(index, 1);
            child.parentNode = null;
          }
          return child;
        },
        querySelector(selector) {
          const wanted = selector.startsWith(".") ? selector.slice(1) : null;
          const walk = (node) => {
            for (const child of node.children) {
              const classes = String(child.className || "").split(/\s+/);
              if (wanted && classes.includes(wanted)) return child;
              const deeper = walk(child);
              if (deeper) return deeper;
            }
            return null;
          };
          return walk(this);
        },
      };
      return el;
    },
    getElementById(id) {
      return doc._byId[id] || null;
    },
  };
  return doc;
}

const makeContainer = (doc) => doc.createElement("div");

check("modul mengumumkan dirinya di globalThis", Boolean(MapNotice) && typeof MapNotice.showMapNotice === "function");

// --- 1. isi pesannya -------------------------------------------------------
const r2Url = "https://pub-13cc00374110455e9437c511bcbdf007.r2.dev/gaspool/ride.json";
const msgR2 = MapNotice.mapLoadFailureMessage(r2Url, null);

check("pesan menyebut peta tidak bisa dimuat", /peta jejak/i.test(msgR2) && /tidak bisa dimuat/i.test(msgR2), msgR2);
check("pesan menegaskan angkanya tetap aman", /tetap aman/i.test(msgR2), msgR2);
check("pesan menyebut sebab khas r2.dev (jaringan memblokir)", /r2\.dev/i.test(msgR2) && /memblokir|blokir/i.test(msgR2), msgR2);

checkEqual("host r2.dev dikenali", MapNotice.isPublicStorageHost(r2Url), true);
checkEqual("host non-storage tidak dikenali", MapNotice.isPublicStorageHost("https://contoh.id/jejak.json"), false);
checkEqual("polyline inline bukan URL", MapNotice.isPublicStorageHost("_p~iF~ps|U_ulLnnqC"), false);

const msgOther = MapNotice.mapLoadFailureMessage("https://contoh.id/jejak.json", null);
check("URL non-storage tidak salah menyebut r2.dev", !/r2\.dev/i.test(msgOther), msgOther);

const msgNamed = MapNotice.mapLoadFailureMessage("https://contoh.id/jejak.json", new Error("HTTP 500"));
check("detail error ikut ditampilkan", /HTTP 500/.test(msgNamed), msgNamed);

const msgInline = MapNotice.mapLoadFailureMessage("_p~iF~ps|U", null);
check("data inline tidak dituduh sebagai masalah jaringan", !/jaringan/i.test(msgInline), msgInline);
check("semua varian tetap menyebut angka aman", [msgOther, msgNamed, msgInline].every((m) => /tetap aman/i.test(m)));

// --- 2. menempel dan membersihkan di DOM ----------------------------------
const doc = makeDoc();
const host = makeContainer(doc);
host.style.position = "relative";

checkEqual("menempel berhasil", MapNotice.showMapNotice(host, msgR2, doc), true);
checkEqual("tepat satu elemen pemberitahuan", host.children.length, 1);
const notice = host.children[0];
checkEqual("kelas ditandai supaya bisa dibersihkan", notice.className, MapNotice.NOTICE_CLASS);
checkEqual("diumumkan lewat role=status", notice.getAttribute("role"), "status");
checkEqual("teksnya persis pesan yang diberikan", notice.textContent, msgR2);
check("diposisikan sebagai lapisan di atas peta", /position:absolute/.test(notice.style.cssText || ""), notice.style.cssText);

MapNotice.showMapNotice(host, "pesan kedua", doc);
checkEqual("memanggil dua kali tidak menumpuk elemen", host.children.length, 1);
checkEqual("pesan terbaru yang bertahan", host.children[0].textContent, "pesan kedua");

checkEqual("membersihkan berhasil", MapNotice.clearMapNotice(host, doc), true);
checkEqual("elemen benar-benar hilang", host.children.length, 0);
checkEqual("membersihkan saat kosong tidak melempar", MapNotice.clearMapNotice(host, doc), true);

check("container tanpa position diurus otomatis", (() => {
  const fresh = makeContainer(doc);
  MapNotice.showMapNotice(fresh, "x", doc);
  return fresh.style.position === "relative";
})());

// --- 3. jalur yang tidak boleh melempar ------------------------------------
const byIdHost = makeContainer(doc);
doc._byId["map-modal"] = byIdHost;
checkEqual("container boleh diberikan sebagai id", MapNotice.showMapNotice("map-modal", "pesan", doc), true);
checkEqual("elemen menempel di container dari id itu", byIdHost.children.length, 1);

checkEqual("id yang tidak ada -> false, bukan lempar", MapNotice.showMapNotice("tidak-ada", "x", doc), false);
checkEqual("container null -> false", MapNotice.showMapNotice(null, "x", doc), false);
checkEqual("doc tanpa createElement -> false", MapNotice.showMapNotice(makeContainer(doc), "x", {}), false);

const failed = results.filter((item) => !item.passed);
for (const item of results) if (!item.passed) console.log(`FAIL: ${item.name} — ${item.detail}`);
console.log(`\n${results.length - failed.length}/${results.length} assertions passed`);
process.exit(failed.length > 0 ? 1 : 0);
