/* ==================================================================
 * anv.to module — search, details, episodes, and stream extraction.
 * Includes Megaplay/Vidwish `enc` decryption & HMAC token minting.
 * ================================================================== */

const ANV_BASE = "https://anv.to";
const MEGAPLAY = "https://megaplay.buzz";
const VIDWISH = "https://vidwish.live";
const VIDTUBE = "https://vidtube.site";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const MP_AES_KEY = "i?LMTAx0Q6,:}50U";
const MP_AES_IV  = "W0;27ToaUpl_P%'c";
const MP_HMAC_KEY = "MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s";
const MP_TOKEN_TTL = 90;

// ---- byte / string helpers -------------------------------------------------
function utf8Bytes(str) {
    const out = [];
    for (let i = 0; i < str.length; i++) {
        let c = str.charCodeAt(i);
        if (c < 0x80) out.push(c);
        else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 63)); }
        else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
            const c2 = str.charCodeAt(i + 1);
            c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00); i++;
            out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        } else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
    }
    return out;
}

function bytesToUtf8(b) {
    let s = "";
    for (let i = 0; i < b.length;) {
        const c = b[i];
        if (c < 0x80) { s += String.fromCharCode(c); i += 1; }
        else if (c < 0xe0) { s += String.fromCharCode(((c & 31) << 6) | (b[i + 1] & 63)); i += 2; }
        else if (c < 0xf0) { s += String.fromCharCode(((c & 15) << 12) | ((b[i + 1] & 63) << 6) | (b[i + 2] & 63)); i += 3; }
        else {
            let cp = ((c & 7) << 18) | ((b[i + 1] & 63) << 12) | ((b[i + 2] & 63) << 6) | (b[i + 3] & 63);
            cp -= 0x10000;
            s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023));
            i += 4;
        }
    }
    return s;
}

const B64C = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function b64ToBytes(str) {
    let s = String(str).replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/=]/g, "");
    const out = [];
    for (let i = 0; i < s.length; i += 4) {
        const c0 = B64C.indexOf(s.charAt(i)), c1 = B64C.indexOf(s.charAt(i + 1));
        const a2 = s.charAt(i + 2), a3 = s.charAt(i + 3);
        const c2 = (a2 === "" || a2 === "=") ? -1 : B64C.indexOf(a2);
        const c3 = (a3 === "" || a3 === "=") ? -1 : B64C.indexOf(a3);
        if (c0 < 0 || c1 < 0) break;
        out.push((c0 << 2) | (c1 >> 4));
        if (c2 >= 0) out.push(((c1 & 15) << 4) | (c2 >> 2));
        if (c3 >= 0) out.push(((c2 & 3) << 6) | c3);
    }
    return out;
}

function bytesToB64url(b) {
    let s = "";
    for (let i = 0; i < b.length; i += 3) {
        const b0 = b[i], b1 = b[i + 1], b2 = b[i + 2];
        s += B64C.charAt(b0 >> 2);
        s += B64C.charAt(((b0 & 3) << 4) | (b1 === undefined ? 0 : b1 >> 4));
        s += (b1 === undefined) ? "" : B64C.charAt(((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6));
        s += (b2 === undefined) ? "" : B64C.charAt(b2 & 63);
    }
    return s.replace(/\+/g, "-").replace(/\//g, "_");
}

function padKey(str, len) {
    const src = utf8Bytes(str), out = new Array(len);
    for (let i = 0; i < len; i++) out[i] = i < src.length ? src[i] : 0;
    return out;
}

// ---- SHA-256 & HMAC-SHA-2
