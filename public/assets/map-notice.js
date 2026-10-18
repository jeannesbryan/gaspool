/**
 * Notice shown when a trail map fails to load.
 *
 * Why this file exists. Every trail map in Gaspool fetches its points from an
 * R2 object from the CLIENT side, not through the server. If that fetch fails
 * (network or ISP blocking r2.dev, hijacked DNS, quota exhausted, object gone),
 * the page used to only write console.error and then leave the map EMPTY. From
 * the user's side an empty map cannot be told apart from "the app is broken",
 * exactly the "silent" pattern this repo avoids.
 *
 * The rules this file holds to:
 * 1. A failure must be VISIBLE on screen, not only in the console.
 * 2. The message names what matters most to the reader: the numbers
 *    (distance, time, speed) are still safe and stored; only the picture
 *    failed.
 * 3. The most common cause is stated plainly: if the address is r2.dev, say
 *    that networks and ISPs often block it, do not blame the user or make
 *    them hunt for a bug that is not there.
 *
 * This file is a plain .js and attaches itself to globalThis so that TWO pages
 * (dashboard and activity detail) can use it without copying, the same pattern
 * as doctor-core.js. Because it uses no `export`, it can be loaded as an
 * ordinary <script src>, so it is ready before the user can press anything
 * (no race with <script type="module">).
 */
(function () {
    'use strict';

    var NOTICE_CLASS = 'map-load-notice';

    var isHttpUrl = function (raw) {
        return typeof raw === 'string' && /^https?:\/\//i.test(raw.trim());
    };

    /** true when the address is Cloudflare public object storage (r2.dev). */
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
     * Human readable message. `rawUrl` = the polyline address that failed to
     * load, `error` = the original error if any (may be null when the cause is
     * not an error, for example only one point could be read).
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

    /**
     * Message for a page that merges MANY trails (heatmap).
     *
     * The difference from a single map: a partial failure deliberately does not
     * stop the drawing, so the result stays a map that "looks full" while some
     * activities are missing. That is more misleading than an empty map,
     * because nothing looks wrong. Return an empty string when nothing actually
     * failed: do not raise an alarm without a cause.
     *
     * @param {number} total    number of activities that were attempted
     * @param {number} failed   how many of them failed
     * @param {boolean} [storageBlocked] true when the address is public storage (r2.dev)
     */
    var heatmapLoadFailureMessage = function (total, failed, storageBlocked) {
        var jumlahTotal = Number(total) > 0 ? Math.floor(Number(total)) : 0;
        var jumlahGagal = Number(failed) > 0 ? Math.floor(Number(failed)) : 0;
        if (jumlahGagal <= 0) return '';
        // Never report more failures than there were attempts.
        if (jumlahTotal > 0 && jumlahGagal > jumlahTotal) jumlahGagal = jumlahTotal;

        var sebab =
            storageBlocked === true
                ? ' Penyebab paling sering: jaringan atau penyedia internet sedang memblokir alamat penyimpanan (r2.dev). Coba buka lewat jaringan lain atau data seluler.'
                : ' Coba muat ulang halaman ini.';

        if (jumlahTotal > 0 && jumlahGagal >= jumlahTotal) {
            return (
                'Peta jejak kosong: semua ' +
                jumlahTotal +
                ' aktivitas gagal dimuat.' +
                sebab +
                ' Data aktivitasnya sendiri tetap aman dan sudah tersimpan.'
            );
        }

        return (
            'Peta jejak ini belum lengkap: ' +
            jumlahGagal +
            (jumlahTotal > 0 ? ' dari ' + jumlahTotal : '') +
            ' aktivitas gagal dimuat, jadi jejaknya tidak ikut tergambar.' +
            sebab +
            ' Data aktivitas yang gagal itu tetap aman dan sudah tersimpan.'
        );
    };

    /**
     * An absolute layer needs a reference. If the container has no position yet,
     * make it relative so the message sticks inside the map.
     *
     * But if the container ALREADY has a position, inline or from CSS, leave it
     * alone. This happened before: the video page used a full screen control
     * layer (position:absolute, z-index 2000); overwriting its position with
     * relative broke the layout, and the message ended up buried under that
     * layer until it was barely readable.
     */
    var ensurePositioned = function (host, doc) {
        if (!host || !host.style || host.style.position) return;
        try {
            var view = doc && doc.defaultView;
            if (view && typeof view.getComputedStyle === 'function') {
                var computed = view.getComputedStyle(host);
                var posisi = computed && computed.position;
                if (posisi && posisi !== 'static') return;
            }
        } catch (err) {
            // Cannot be read -> treat it as static, then make it relative.
        }
        host.style.position = 'relative';
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
     * Attach the message as a layer on top of the map. Safe to call repeatedly:
     * the old message is replaced, it does not stack into several layers.
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

        ensurePositioned(host, document_);

        if (typeof host.appendChild !== 'function') return false;
        host.appendChild(el);
        return true;
    };

    globalThis.MapNotice = {
        NOTICE_CLASS: NOTICE_CLASS,
        isHttpUrl: isHttpUrl,
        isPublicStorageHost: isPublicStorageHost,
        mapLoadFailureMessage: mapLoadFailureMessage,
        heatmapLoadFailureMessage: heatmapLoadFailureMessage,
        showMapNotice: showMapNotice,
        clearMapNotice: clearMapNotice,
    };
})();
