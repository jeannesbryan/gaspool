/**
 * Pemberitahuan saat peta jejak gagal dimuat.
 *
 * Kenapa berkas ini ada. Setiap peta jejak di Gaspool mengambil titiknya dari
 * objek R2 lewat fetch() di sisi KLIEN — bukan lewat server. Kalau fetch itu
 * gagal (jaringan/ISP memblokir r2.dev, DNS dihijack, kuota habis, objeknya
 * hilang), dulu halaman hanya menulis console.error lalu petanya tinggal
 * KOSONG. Dari sisi pemakai, peta kosong tidak bisa dibedakan dari "aplikasi
 * rusak" — persis pola "diam" yang di repo ini dihindari.
 *
 * Aturan yang dipegang berkas ini:
 * 1. Kegagalan harus TERLIHAT di layar, bukan cuma di konsol.
 * 2. Pesannya menyebut hal yang paling penting bagi yang membaca: angkanya
 *    (jarak, waktu, kecepatan) tetap aman dan tersimpan; yang gagal hanya
 *    gambarnya.
 * 3. Sebab yang paling sering disebut apa adanya — kalau alamatnya r2.dev,
 *    katakan bahwa jaringan/ISP kerap memblokirnya, jangan menyalahkan
 *    pengguna atau membuatnya mencari bug yang tidak ada.
 *
 * Berkas ini .js biasa dan menempelkan dirinya ke globalThis supaya dipakai
 * DUA halaman (dashboard dan detail aktivitas) tanpa disalin — pola yang sama
 * dengan doctor-core.js. Karena tidak memakai `export`, ia bisa dimuat sebagai
 * <script src> biasa, sehingga sudah siap sebelum pengguna sempat menekan apa
 * pun (tidak ada balapan dengan <script type="module">).
 */
(function () {
    'use strict';

    var NOTICE_CLASS = 'map-load-notice';

    var isHttpUrl = function (raw) {
        return typeof raw === 'string' && /^https?:\/\//i.test(raw.trim());
    };

    /** true kalau alamatnya penyimpanan objek publik Cloudflare (r2.dev). */
    var isPublicStorageHost = function (raw) {
        if (typeof raw !== 'string') return false;
        try {
            var host = new URL(raw.trim()).hostname;
            return /(^|\.)r2\.dev$/i.test(host);
        } catch (err) {
            return false;
        }
    };

    /**
     * Pesan yang dibaca manusia. `rawUrl` = alamat polyline yang gagal diambil,
     * `error` = error aslinya kalau ada (boleh null kalau penyebabnya bukan
     * error, misalnya titik yang terbaca cuma satu).
     */
    var mapLoadFailureMessage = function (rawUrl, error) {
        var parts = [
            'Peta jejak tidak bisa dimuat, jadi gambarnya belum tampil. Jarak, waktu, dan kecepatan aktivitas ini tetap aman dan sudah tersimpan.',
        ];

        if (isPublicStorageHost(rawUrl)) {
            parts.push(
                'Penyebab paling sering: jaringan atau penyedia internet sedang memblokir alamat penyimpanan (r2.dev). Coba buka lewat jaringan lain atau data seluler.',
            );
        } else if (isHttpUrl(rawUrl)) {
            parts.push('Titik jejaknya gagal diambil dari alamat penyimpanannya. Coba muat ulang halaman ini.');
        } else {
            parts.push('Data jejak aktivitas ini tidak bisa dibaca, jadi gambarnya tidak bisa digambar.');
        }

        if (error) {
            var detail = error && error.message ? error.message : String(error);
            if (detail) parts.push('Detail teknis: ' + detail);
        }

        return parts.join(' ');
    };

    var resolveContainer = function (container, doc) {
        if (!container) return null;
        if (typeof container === 'string') return doc ? doc.getElementById(container) : null;
        return container;
    };

    var clearMapNotice = function (container, doc) {
        var host = resolveContainer(container, doc || globalThis.document);
        if (!host || typeof host.querySelector !== 'function') return false;

        var existing = host.querySelector('.' + NOTICE_CLASS);
        if (!existing) return true;

        var parent = existing.parentNode;
        if (parent && typeof parent.removeChild === 'function') {
            parent.removeChild(existing);
            return true;
        }
        if (typeof host.removeChild === 'function') {
            try {
                host.removeChild(existing);
                return true;
            } catch (err) {
                return false;
            }
        }
        return false;
    };

    /**
     * Tempelkan pesan sebagai lapisan di atas peta. Dipanggil berulang kali aman:
     * pesan lama diganti, tidak menumpuk jadi beberapa lapis.
     */
    var showMapNotice = function (container, message, doc) {
        var document_ = doc || globalThis.document;
        var host = resolveContainer(container, document_);
        if (!host || !document_ || typeof document_.createElement !== 'function') return false;

        clearMapNotice(host, document_);

        var el = document_.createElement('div');
        el.className = NOTICE_CLASS;
        el.setAttribute('role', 'status');
        el.textContent = message;
        el.style.cssText =
            'position:absolute;left:10px;right:10px;bottom:12px;z-index:1200;' +
            'background:rgba(10,10,18,.94);border:1px solid rgba(255,95,0,.6);color:#fff;' +
            'border-radius:12px;padding:10px 12px;font:12px/1.5 system-ui,-apple-system,sans-serif;' +
            'text-align:left;pointer-events:none;';

        // Lapisan absolut butuh acuan; kalau container-nya belum relatif, jadikan.
        if (host.style && !host.style.position) host.style.position = 'relative';

        if (typeof host.appendChild !== 'function') return false;
        host.appendChild(el);
        return true;
    };

    globalThis.MapNotice = {
        NOTICE_CLASS: NOTICE_CLASS,
        isHttpUrl: isHttpUrl,
        isPublicStorageHost: isPublicStorageHost,
        mapLoadFailureMessage: mapLoadFailureMessage,
        showMapNotice: showMapNotice,
        clearMapNotice: clearMapNotice,
    };
})();
