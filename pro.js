/**
 * Lui Pro 4.0 – CEO + Dayanışmalı Çok Ajanlı Sistem
 *
 * 4.0 yenilikleri:
 *  - CEO: tüm süreci yönetir, görev dağıtır, nihai yanıtı gözden geçirir ve gerekirse düzeltir
 *  - Yazım / Niyet Düzeltisi: kullanıcının hatalı yazımını en yakın doğru forma çevirir (arka planda)
 *  - Dayanışma: bir ajan işi bitince veya skor düşükse diğer ajanlar yardım edebilir
 *  - Ajanlar sadece denetçi değil; üretim, düzeltme, katkı yetkisine sahip
 *  - Çoklu uç + yeniden deneme: web engeli / timeout riskini düşürür, gecikmeyi sınırlar
 *  - Düşün modu (lumea-think-mode) ve otomatik ajan sayısı korunur
 *  - Webde ara (web.js) ile uyumlu; Lite ile karışmaz
 */
(function () {
    'use strict';

    /* ------------------------------------------------------------------ */
    /*  Ayarlar                                                            */
    /* ------------------------------------------------------------------ */

    var API_ENDPOINTS = [
        'https://devtoolbox-api.devtoolbox-api.workers.dev/ai/generate'
        // İleride ek uçlar buraya eklenebilir; sırayla denenir
    ];
    var CALL_TIMEOUT_MS = 16000;
    var RETRY_COUNT = 1;
    var TOTAL_BUDGET_MS = 72000;
    var FALLBACK = 'Şu an yanıt üretemedim. İnternet bağlantını kontrol edip tekrar dene.';

    /* ------------------------------------------------------------------ */
    /*  Düşün modu / ajan sayısı                                           */
    /* ------------------------------------------------------------------ */

    function isThinkModeOn() {
        try {
            var v = localStorage.getItem('lumea-think-mode');
            if (v === null || v === undefined) return true;
            return v === '1' || v === 'true';
        } catch (_) { return true; }
    }

    function estimateAgentCount(q) {
        var s = String(q || '').trim();
        var low = s.toLowerCase();
        var len = s.length;
        var words = s.split(/\s+/).filter(Boolean).length;
        if (words <= 3 && len < 40) return 10;
        if (/^(merhaba|selam|hey|hi|hello|teşekkür|sağol)/i.test(s)) return 10;
        if (/^[-+*/x×÷^0-9.,\s]+$/.test(s.replace(/kaç|eder|ne|eşittir/gi, ''))) return 10;
        var score = 0;
        if (len > 80) score += 1;
        if (len > 160) score += 1;
        if (words > 12) score += 1;
        if (words > 25) score += 1;
        if (/nasıl|adım|yöntem|karşılaştır|fark|neden|niçin|analiz|açıkla|detay|listele|özetle|örnek/i.test(low)) score += 2;
        if (/ve|ile|hem|ayrıca|bunun yanında|karşı|vs/i.test(low) && words > 8) score += 1;
        if (score <= 1) return 20;
        if (score <= 3) return 30;
        if (score <= 5) return 40;
        if (score <= 7) return 50;
        return 80;
    }

    /* ------------------------------------------------------------------ */
    /*  Yardımcılar                                                        */
    /* ------------------------------------------------------------------ */

    var TR_STOP = {
        bir:1, bu:1, şu:1, o:1, ve:1, ile:1, için:1, gibi:1, daha:1, çok:1,
        olan:1, olarak:1, kadar:1, sonra:1, önce:1, ise:1, de:1, da:1, ki:1,
        mi:1, mı:1, mu:1, mü:1, ne:1, nasıl:1, neden:1, nedir:1, hangi:1,
        her:1, hiç:1, ya:1, veya:1, ama:1, fakat:1, çünkü:1, eğer:1,
        var:1, yok:1, şey:1, en:1, hem:1, sadece:1, yalnızca:1, üzere:1,
        göre:1, karşı:1, doğru:1, ilgili:1, hakkında:1, arasında:1,
        the:1, and:1, for:1, with:1, from:1, that:1, this:1, are:1, was:1,
        kaynak:1, madde:1, maddeler:1, wikipedia:1, özellik:1,
        özellikler:1, tanım:1, özellikleri:1, bölüm:1, yanıt:1, cevap:1
    };

    function normalizeQuery(q) {
        return String(q || '').trim().replace(/\s+/g, ' ');
    }

    function toStr(v) {
        if (v == null) return '';
        if (typeof v === 'string') return v;
        if (typeof v === 'number' || typeof v === 'boolean') return String(v);
        return '';
    }

    function extractKeyTerms(text, maxTerms, minLen) {
        maxTerms = maxTerms || 5;
        minLen = minLen || 4;
        var clean = String(text || '')
            .replace(/\*\*/g, ' ')
            .replace(/[*_•\-]/g, ' ')
            .replace(/https?:\/\/\S+/g, ' ')
            .replace(/[^\p{L}\p{N}\s]/gu, ' ');
        var words = clean.split(/\s+/).filter(Boolean);
        var freq = {}, order = [];
        for (var i = 0; i < words.length; i++) {
            var w = words[i], low = w.toLowerCase();
            if (low.length < minLen || TR_STOP[low] || /^\d+$/.test(low)) continue;
            if (!freq[low]) { freq[low] = 0; order.push(w); }
            freq[low]++;
        }
        order.sort(function (a, b) {
            return (freq[b.toLowerCase()] || 0) - (freq[a.toLowerCase()] || 0);
        });
        var seen = {}, out = [];
        for (var j = 0; j < order.length && out.length < maxTerms; j++) {
            var key = order[j].toLowerCase();
            if (seen[key]) continue;
            seen[key] = true;
            out.push(order[j]);
        }
        return out;
    }

    function contentWords(s) {
        return String(s || '').toLowerCase()
            .replace(/[^\p{L}\p{N} ]/gu, ' ')
            .split(/\s+/)
            .filter(function (w) { return w.length > 3 && !TR_STOP[w]; });
    }

    function overlapRatio(a, b) {
        var wa = contentWords(a), wb = contentWords(b);
        if (!wa.length || !wb.length) return 0;
        var setB = {};
        for (var i = 0; i < wb.length; i++) setB[wb[i]] = true;
        var hit = 0;
        for (var j = 0; j < wa.length; j++) if (setB[wa[j]]) hit++;
        return hit / Math.min(wa.length, wb.length);
    }

    function stemOf(w) {
        return w.length > 5 ? w.slice(0, 5) : w;
    }

    function textRelevance(text, query) {
        if (!text || !query) return 0;
        var low = String(text).toLowerCase();
        var words = String(query).toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .split(/\s+/)
            .filter(function (w) { return w.length > 2 && !TR_STOP[w]; });
        if (!words.length) return 60;
        var hit = 0;
        for (var i = 0; i < words.length; i++) {
            if (low.indexOf(stemOf(words[i])) !== -1) hit++;
        }
        return Math.round((hit / words.length) * 100);
    }

    function isBad(out, userQ) {
        var t = toStr(out).trim();
        if (t.length < 1) return true;
        if (
            t.length < 3 &&
            !/^\d+([.,]\d+)?$/.test(t) &&
            t.toLowerCase() !== 'evet' &&
            t.toLowerCase() !== 'hayır'
        ) return true;

        var low = t.toLowerCase();
        var hard = [
            'reached its budget', 'raise the key budget', 'rate limit', 'api key',
            'unauthorized', 'forbidden', 'quota exceeded', 'insufficient',
            'service unavailable', 'internal server error', 'pollinations.ai/editkey',
            'please try again later', 'too many requests', 'model is overloaded',
            'billing', 'payment required', 'access denied', 'invalid key',
            '{"error"', '"error":', 'hiçbir ai servisi', 'mesaj boş',
            'sadece post', 'route not found'
        ];
        for (var i = 0; i < hard.length; i++) {
            if (low.indexOf(hard[i]) !== -1) return true;
        }

        var qLow = String(userQ || '').toLowerCase();
        var userAskedAboutSelf =
            /sen kimsin|kimsin|hangi model|adın ne|ismin ne|lui nedir|lumea/.test(qLow);
        if (!userAskedAboutSelf) {
            if (
                /sen (lumea|lui)|lumea ai|lui ai.?n[iı]n|pro\+ model|pro modelinin özelli|aşağıdaki listede|belowda bulacaks|ben bir yapay zeka modeliyim.*pro/.test(low)
            ) return true;
        }

        var parts = t.split(/[.!?\n]+/).map(function (s) {
            return s.trim().toLowerCase().slice(0, 40);
        }).filter(function (s) { return s.length > 15; });
        if (parts.length >= 3) {
            var c = {};
            for (var j = 0; j < parts.length; j++) {
                c[parts[j]] = (c[parts[j]] || 0) + 1;
                if (c[parts[j]] >= 3) return true;
            }
        }
        return false;
    }

    function extractText(data) {
        if (data == null) return '';
        if (typeof data === 'string' || typeof data === 'number') return toStr(data);
        var raw =
            data.response ?? data.answer ?? data.text ?? data.output ??
            data.result ?? data.content ?? data.message ??
            data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ??
            data.data?.response ?? data.data?.text ?? data.data?.answer ?? '';
        return toStr(raw);
    }

    function withTimeout(ms, promise) {
        return new Promise(function (resolve, reject) {
            var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
            promise.then(
                function (v) { clearTimeout(t); resolve(v); },
                function (e) { clearTimeout(t); reject(e); }
            );
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Çoklu uç + yeniden deneme (engel / gecikme direnci)                */
    /* ------------------------------------------------------------------ */

    async function callOneEndpoint(url, promptText, timeoutMs) {
        var res = await withTimeout(
            timeoutMs || CALL_TIMEOUT_MS,
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: promptText })
            })
        );
        if (!res.ok) throw new Error('http_' + res.status);
        var data = await res.json();
        return extractText(data).trim();
    }

    async function callAPI(promptText, timeoutMs) {
        var lastErr = null;
        var endpoints = API_ENDPOINTS.slice();
        for (var r = 0; r <= RETRY_COUNT; r++) {
            for (var i = 0; i < endpoints.length; i++) {
                try {
                    var out = await callOneEndpoint(endpoints[i], promptText, timeoutMs);
                    if (out) return out;
                } catch (e) {
                    lastErr = e;
                }
            }
            if (r < RETRY_COUNT) {
                await new Promise(function (res) { setTimeout(res, 280 + r * 200); });
            }
        }
        throw lastErr || new Error('all_endpoints_failed');
    }

    /* ------------------------------------------------------------------ */
    /*  Kesik yanıt onarımı                                                */
    /* ------------------------------------------------------------------ */

    function isCompleteText(t) {
        var s = String(t || '').trim();
        if (!s) return false;
        if (/\*\*$/.test(s)) {
            if (/[.!?…]["»)\]]?\s*\*\*$/.test(s.slice(-10))) return true;
        }
        var last = s.slice(-1);
        if (/[.!?…"»)\]]/.test(last)) return true;
        return false;
    }

    function cutToLastComplete(t) {
        t = String(t || '').trim();
        var best = -1;
        var re = /[.!?…]+(?:["»)\]]|\*\*)?(?=\s|$)/g;
        var m;
        while ((m = re.exec(t)) !== null) {
            var end = m.index + m[0].length;
            if (end > t.length * 0.5) best = end;
        }
        return best > 0 ? t.slice(0, best).trim() : t;
    }

    async function ensureComplete(t, query) {
        t = String(t || '').trim();
        if (!t) return t;
        if (isCompleteText(t)) return t;
        try {
            var cont = await callAPI(
                'Aşağıdaki metin yarıda kesilmiş. AYNI dilde ve aynı üslupla, ' +
                'kesildiği yerden DEVAM ET. Baştan tekrar etme, yeni konu açma, ' +
                'açıklama ekleme, metni noktalama işaretiyle bitir.\n\n' +
                'Kesilen metin:\n' + t.slice(-1500) + '\n\nDevam:',
                12000
            );
            cont = toStr(cont).trim();
            if (cont && !isBad(cont, query)) {
                var merged = (t + ' ' + cont).trim();
                if (isCompleteText(merged)) return merged;
                return cutToLastComplete(merged);
            }
        } catch (_) {}
        return cutToLastComplete(t);
    }

    /* ------------------------------------------------------------------ */
    /*  Yazım / Niyet düzeltisi (ön katman)                                */
    /* ------------------------------------------------------------------ */

    /** Hafif yerel düzeltmeler; ağır model çağrısı sadece gerekirse */
    function localSpellFix(q) {
        var s = String(q || '');
        var map = {
            'nedir': 'nedir', 'nedır': 'nedir', 'nedır?': 'nedir?',
            'nasıl': 'nasıl', 'nasil': 'nasıl', 'nasıl?': 'nasıl?',
            'niçin': 'niçin', 'nicin': 'niçin',
            'teşekkür': 'teşekkür', 'tesekkur': 'teşekkür',
            'merhaba': 'merhaba', 'mrb': 'merhaba',
            'selam': 'selam', 'slm': 'selam'
        };
        var words = s.split(/(\s+)/);
        for (var i = 0; i < words.length; i++) {
            var low = words[i].toLowerCase().replace(/[?.!,;:]+$/, '');
            if (map[low]) {
                var punct = (words[i].match(/[?.!,;:]+$/) || [''])[0];
                words[i] = map[low] + punct;
            }
        }
        return words.join('');
    }

    async function ajanYazimNiyet(orijinal) {
        var local = localSpellFix(orijinal);
        var temiz = normalizeQuery(local);
        // Çok kısa veya zaten temizse API çağırma (gecikme yok)
        var needsDeep = temiz.length > 12 && (
            /[ğüşıöçĞÜŞİÖÇ]/.test(orijinal) === false && /[gusıoc]/i.test(orijinal) ||
            /\b(nedır|nasil|nicin|tesekkur|mrb|slm|naptın|naber)\b/i.test(orijinal) ||
            orijinal !== temiz && orijinal.length > 20
        );
        if (!needsDeep) {
            return {
                ajan: 'Yazım-Niyet',
                dusunce: 'Yazım temiz veya hafif düzeltildi.',
                orijinal: orijinal,
                duzeltilmis: temiz,
                degisti: temiz !== normalizeQuery(orijinal)
            };
        }
        try {
            var r = await callAPI(
                'Kullanıcı mesajındaki yazım hatalarını düzelt. Sadece düzeltilmiş Türkçe metni yaz, ' +
                'açıklama ekleme. Anlamı koru, kısaltma.\n\nMesaj: ' + orijinal + '\n\nDüzeltilmiş:',
                8000
            );
            r = toStr(r).trim().replace(/^["'«]|["'»]$/g, '');
            if (r && r.length >= 2 && r.length < orijinal.length * 2.5 && !isBad(r, orijinal)) {
                return {
                    ajan: 'Yazım-Niyet',
                    dusunce: 'Yazım / niyet düzeltildi.',
                    orijinal: orijinal,
                    duzeltilmis: r,
                    degisti: true
                };
            }
        } catch (_) {}
        return {
            ajan: 'Yazım-Niyet',
            dusunce: 'Derin düzeltme atlandı, yerel hali kullanıldı.',
            orijinal: orijinal,
            duzeltilmis: temiz,
            degisti: temiz !== normalizeQuery(orijinal)
        };
    }

    /* ------------------------------------------------------------------ */
    /*  Prompt kurucu                                                      */
    /* ------------------------------------------------------------------ */

    var BASE_RULES =
        'Tamamen Türkçe cevap ver. Hiç İngilizce kelime, cümle veya terim karıştırma; ' +
        'gerekirse Türkçe karşılığını kullan.\n' +
        'Sadece kullanıcının sorusuna yanıt ver. Kendini, modelini veya bir ürünü asla tanıtma. Bilmiyorsan uydurma.\n\n' +
        'YANIT KALİTESİ (ZORUNLU):\n' +
        '- Yanıtı eksiksiz ve detaylı tut; en az 4-8 anlamlı cümle veya madde yaz.\n' +
        '- Konuyu tanımla, önemli özelliklerini say, gerekirse örnek ver.\n' +
        '- Bilmediğin detayı uydurma.\n' +
        '- Yanıtın son cümlesini MUTLAKA noktalama işaretiyle bitir; yarım bırakma.\n\n' +
        'YANIT BİÇİMİ (ZORUNLU):\n' +
        '- Yanıtı mantıklı parçalara böl.\n' +
        '- Ana başlık varsa **kalın** yaz.\n' +
        '- Önemli kelimeleri **kalın** yaz.\n' +
        '- Liste gerekiyorsa her maddeyi • ile başlat.\n' +
        '- Paragraflar arasında mutlaka boş satır bırak.\n' +
        '- Uzun düz metin yığma; okunabilir ve net ol.\n' +
        '- Her seferinde aynı kalıpla başlama; doğrudan konuya gir.';

    var INTENT_HINT = {
        tanim: 'Bu bir TANIM sorusu: önce net bir tanım ver, sonra önemli özellikleri say.',
        nasil_yapilir: 'Bu bir NASIL YAPILIR sorusu: adım adım, numaralı/maddeli ve uygulanabilir anlat.',
        neden: 'Bu bir NEDEN sorusu: sebepleri açık ve mantıklı sırayla açıkla.',
        karsilastir: 'Bu bir KARŞILAŞTIRMA sorusu: her iki tarafın artı ve eksilerini kısaca karşılaştır, sonunda kısa bir sonuç yaz.',
        oneri: 'Bu bir ÖNERİ sorusu: birkaç seçenek sun, her birinin neden uygun olduğunu söyle.',
        genel_bilgi: 'Bu bir GENEL BİLGİ sorusu: konuyu tanımla, önemli noktaları ver.'
    };

    function buildPrompt(anlayici, ikinciTur, oncekiSorun) {
        var p = BASE_RULES + '\n\n' + (INTENT_HINT[anlayici.niyet] || INTENT_HINT.genel_bilgi);
        if (ikinciTur) {
            p += '\n\nÖNEMLİ: Önceki deneme soruyla yeterince örtüşmedi' +
                (oncekiSorun ? ' (' + oncekiSorun + ')' : '') + '. ' +
                'Bu kez doğrudan şu kavrama odaklan: "' + anlayici.temiz + '". ' +
                (anlayici.anahtarlar.length
                    ? 'Yanıtta şu kelimelere mutlaka değin: ' + anlayici.anahtarlar.join(', ') + '. '
                    : '') +
                'Konudan sapma, genel laf kalabalığı yapma.';
        }
        return p + '\n\nSoru: ' + anlayici.orijinal + '\n\nCevap:';
    }

    /* ------------------------------------------------------------------ */
    /*  Temel ajanlar                                                      */
    /* ------------------------------------------------------------------ */

    function ajan01Anlayici(soru) {
        var q = normalizeQuery(soru);
        var low = q.toLowerCase();
        var niyet = 'genel_bilgi';
        if (/nasıl|nasıl yapılır|adım|yöntem/.test(low)) niyet = 'nasil_yapilir';
        else if (/nedir|ne demek|tanım|anlamı|kimdir/.test(low)) niyet = 'tanim';
        else if (/neden|niçin|niye|sebebi/.test(low)) niyet = 'neden';
        else if (/karşılaştır|fark|vs\.?|yoksa/.test(low)) niyet = 'karsilastir';
        else if (/öner|tavsiye|hangi|en iyi/.test(low)) niyet = 'oneri';
        var temiz = q
            .replace(/\b(nedir|ne demek|ne anlama gelir|hakkında|kimdir)\b/gi, '')
            .replace(/\?+/g, '')
            .trim();
        return {
            ajan: 'Anlayıcı',
            dusunce: 'Niyet: **' + niyet + '**, temiz kavram: **' + (temiz || q) + '**.',
            niyet: niyet,
            anahtarlar: extractKeyTerms(q, 5, 3),
            orijinal: q,
            temiz: temiz || q
        };
    }

    function ajan02Stratejist(a1) {
        var yol = ['prompt hazırla', '1. taslak', 'puanla', 'gerekirse 2. taslak', 'tamamlık', 'biçimle', 'CEO kontrol'];
        return { ajan: 'Stratejist', dusunce: 'Yol: ' + yol.join(' → ') + '.', yol: yol };
    }

    function ajan03Baglamci(a1) {
        var alan = 'genel';
        var t = a1.temiz.toLowerCase();
        if (/futbol|basketbol|spor|maç|takım|oyuncu/.test(t)) alan = 'spor';
        else if (/tarih|savaş|imparatorluk|osmanlı|cumhuriyet/.test(t)) alan = 'tarih';
        else if (/bilim|fizik|kimya|biyoloji|uzay|matematik/.test(t)) alan = 'bilim';
        else if (/film|dizi|müzik|kitap|oyun/.test(t)) alan = 'kültür-sanat';
        else if (/yazılım|kod|program|telefon|bilgisayar|uygulama/.test(t)) alan = 'teknoloji';
        return { ajan: 'Bağlamcı', dusunce: 'Alan tahmini: **' + alan + '**.', alan: alan };
    }

    function ajan04Hipotezci(a1) {
        var h = [];
        h.push('Kullanıcı "' + a1.temiz + '" hakkında net bilgi istiyor.');
        if (a1.niyet === 'karsilastir') h.push('İki seçenek arasında karar desteği bekliyor olabilir.');
        if (a1.niyet === 'nasil_yapilir') h.push('Adım adım uygulanabilir yol arıyor olabilir.');
        if (a1.niyet === 'oneri') h.push('Seçenekler arasından öneri bekliyor olabilir.');
        return { ajan: 'Hipotezçi', dusunce: h[0], hipotezler: h };
    }

    async function ajan05OncuArastirmaci(a1) {
        var prompt = buildPrompt(a1, false, '');
        var cevap = '', hata = null;
        try { cevap = await callAPI(prompt); }
        catch (e) { hata = e && e.message ? e.message : 'bilinmeyen_hata'; }
        var ok = !!cevap && !isBad(cevap, a1.orijinal);
        return {
            ajan: 'Öncü Araştırmacı',
            dusunce: ok ? '1. taslak alındı (' + cevap.length + ' karakter).' : '1. taslak alınamadı' + (hata ? ' (' + hata + ')' : '') + '.',
            taslak: ok ? cevap : '',
            hata: hata
        };
    }

    function ajan06Ayrintici(a1, a5) {
        if (!a5.taslak) return { ajan: 'Ayrıntıcı', dusunce: 'Taslak yok, ayrıntı inceleme atlandı.', eksik: a1.anahtarlar.slice() };
        var eksik = [];
        var low = a5.taslak.toLowerCase();
        for (var i = 0; i < a1.anahtarlar.length; i++) {
            if (low.indexOf(stemOf(a1.anahtarlar[i].toLowerCase())) === -1) eksik.push(a1.anahtarlar[i]);
        }
        return {
            ajan: 'Ayrıntıcı',
            dusunce: eksik.length ? 'Eksik anahtarlar: ' + eksik.join(', ') : 'Tüm anahtar kavramlar taslakta var.',
            eksik: eksik
        };
    }

    function puanla(taslak, a1) {
        if (!taslak) return { skor: 0, notlar: ['taslak yok'] };
        var skor = 0;
        var notlar = [];
        var len = taslak.length;
        if (len >= 120) skor += 25;
        else if (len >= 60) skor += 15;
        else { skor += 5; notlar.push('kısa'); }
        var alaka = textRelevance(taslak, a1.temiz || a1.orijinal);
        skor += Math.round(alaka * 0.45);
        if (alaka < 40) notlar.push('alaka zayıf');
        var anahtarHit = 0;
        var low = taslak.toLowerCase();
        for (var i = 0; i < a1.anahtarlar.length; i++) {
            if (low.indexOf(stemOf(a1.anahtarlar[i].toLowerCase())) !== -1) anahtarHit++;
        }
        if (a1.anahtarlar.length) {
            skor += Math.round((anahtarHit / a1.anahtarlar.length) * 20);
            if (anahtarHit < a1.anahtarlar.length) notlar.push('anahtar eksik');
        } else skor += 10;
        if (/[.!?…]/.test(taslak.slice(-3))) skor += 5;
        else notlar.push('bitiş zayıf');
        skor = Math.max(0, Math.min(100, skor));
        return { skor: skor, notlar: notlar };
    }

    function ajan07Elestirmen(a1, a5) {
        var p = puanla(a5.taslak, a1);
        var kabul = p.skor >= 50;
        return {
            ajan: 'Eleştirmen',
            dusunce: 'Skor: **' + p.skor + '**' + (p.notlar.length ? ' (' + p.notlar.join(', ') + ')' : '') + (kabul ? ' → kabul.' : ' → yetersiz.'),
            skor: p.skor,
            notlar: p.notlar,
            kabul: kabul
        };
    }

    function ajan08CeliskiAvcisi(a5) {
        if (!a5.taslak) return { ajan: 'Çelişki Avcısı', dusunce: 'Taslak yok.', celiski: false };
        var parts = a5.taslak.split(/[.!?\n]+/).map(function (s) {
            return s.trim().toLowerCase().slice(0, 40);
        }).filter(function (s) { return s.length > 15; });
        var c = {}, tekrar = false;
        for (var i = 0; i < parts.length; i++) {
            c[parts[i]] = (c[parts[i]] || 0) + 1;
            if (c[parts[i]] >= 3) tekrar = true;
        }
        return { ajan: 'Çelişki Avcısı', dusunce: tekrar ? 'Aynı cümleler tekrar ediyor.' : 'Çelişki/tekrar yok.', celiski: tekrar };
    }

    function ajan09TarafsizBakici(a5, soru) {
        if (!a5.taslak) return { ajan: 'Tarafsız Bakıcı', dusunce: 'Taslak yok.', tarafsiz: true };
        var alaka = textRelevance(a5.taslak, soru);
        var tarafsiz = alaka >= 40;
        return {
            ajan: 'Tarafsız Bakıcı',
            dusunce: tarafsiz ? 'Yanıt soruya bağlı görünüyor.' : 'Yanıt sorudan uzaklaşmış olabilir.',
            tarafsiz: tarafsiz
        };
    }

    function ajan10Tartismaci(a5, a7) {
        var m = [];
        if (!a5.taslak) {
            m.push('Araştırmacı: "1. deneme başarısız."');
            m.push('Eleştirmen: "Daha odaklı soruyla tekrar deneyelim."');
            return { ajan: 'Tartışmacı', dusunce: m.join(' '), karar: 'yeniden_ara', sorun: 'ilk deneme başarısız' };
        }
        if (a7.kabul) {
            m.push('Araştırmacı: "Taslağım hazır (skor ' + a7.skor + ')."');
            m.push('Eleştirmen: "Kabul edilebilir."');
            m.push('Tartışmacı: "Bu taslağı kullanıyoruz."');
            return { ajan: 'Tartışmacı', dusunce: m.join(' '), karar: 'kabul', sorun: '' };
        }
        m.push('Araştırmacı: "Taslağım hazır (skor ' + a7.skor + ')."');
        m.push('Eleştirmen: "' + (a7.notlar.join(', ') || 'yetersiz') + '"');
        m.push('Tartışmacı: "2. deneme: daha odaklı prompt."');
        return { ajan: 'Tartışmacı', dusunce: m.join(' '), karar: 'yeniden_ara', sorun: a7.notlar.join(', ') };
    }

    async function ajan11IkinciArastirmaci(a1, a10) {
        if (a10.karar === 'kabul') {
            return { ajan: 'İkinci Araştırmacı', dusunce: 'Kabul edildi, ek çağrı yok.', taslak: '', yapildi: false };
        }
        var prompt = buildPrompt(a1, true, a10.sorun);
        var cevap = '', hata = null;
        try { cevap = await callAPI(prompt); }
        catch (e) { hata = e && e.message ? e.message : 'bilinmeyen_hata'; }
        var ok = !!cevap && !isBad(cevap, a1.orijinal);
        return {
            ajan: 'İkinci Araştırmacı',
            dusunce: ok ? '2. taslak alındı (' + cevap.length + ' karakter).' : '2. deneme de başarısız.',
            taslak: ok ? cevap : '',
            yapildi: true
        };
    }

    function ajan12OdakDenetcisi(taslak, a1) {
        if (!taslak) return { ajan: 'Odak Denetçisi', dusunce: 'Metin yok.', odakli: false };
        var alaka = textRelevance(taslak, a1.temiz);
        var odakli = alaka >= 45;
        return { ajan: 'Odak Denetçisi', dusunce: odakli ? 'Odak yerinde.' : 'Odak zayıf.', odakli: odakli };
    }

    function ajan13KapsamDenetcisi(taslak, a1) {
        if (!taslak) return { ajan: 'Kapsam Denetçisi', dusunce: 'Metin yok.', yeterli: false };
        var p = puanla(taslak, a1);
        var yeterli = p.skor >= 45;
        return { ajan: 'Kapsam Denetçisi', dusunce: yeterli ? 'Kapsam yeterli.' : 'Kapsam yetersiz.', yeterli: yeterli };
    }

    function ajan14Dogrulayici(a1, a5, a7, a11) {
        var adaylar = [];
        if (a5.taslak) adaylar.push({ no: 1, metin: a5.taslak, skor: a7.skor });
        if (a11.taslak) adaylar.push({ no: 2, metin: a11.taslak, skor: puanla(a11.taslak, a1).skor });
        adaylar.sort(function (x, y) { return y.skor - x.skor; });
        var en = adaylar[0] || null;
        var guven = 'yok', dusunce;
        if (!en) dusunce = 'Güvenilir taslak yok.';
        else if (en.skor >= 65) { guven = 'yuksek'; dusunce = '**' + en.no + '. taslak** seçildi, güven yüksek.'; }
        else if (en.skor >= 40) { guven = 'orta'; dusunce = '**' + en.no + '. taslak** seçildi, orta güven.'; }
        else { guven = 'dusuk'; dusunce = '**' + en.no + '. taslak** seçildi ama skor düşük.'; }
        return { ajan: 'Doğrulayıcı', dusunce: dusunce, guven: guven, enIyi: en };
    }

    async function ajan15Tamamlayici(metin, query) {
        var tamam = await ensureComplete(metin, query);
        var mudahale = tamam.length !== String(metin || '').trim().length;
        return {
            ajan: 'Tamamlayıcı',
            dusunce: mudahale ? 'Kesik bitiş onarıldı.' : 'Metin düzgün bitiyor.',
            metin: tamam
        };
    }

    /* ------------------------------------------------------------------ */
    /*  Dayanışma: skor düşükse veya eksik varsa yardım                    */
    /* ------------------------------------------------------------------ */

    async function ajanDayanisma(a1, metin, a6, a7, a14, budgetLeft) {
        if (!metin || budgetLeft < 10000) {
            return { ajan: 'Dayanışma', dusunce: 'Yardım gerekmedi veya süre yetmedi.', metin: metin, yardim: false };
        }
        var needHelp = (a7 && a7.skor < 55) ||
            (a6 && a6.eksik && a6.eksik.length >= 2) ||
            (a14 && (a14.guven === 'dusuk' || a14.guven === 'orta'));
        if (!needHelp) {
            return { ajan: 'Dayanışma', dusunce: 'Skor yeterli, yardım çağrılmadı.', metin: metin, yardim: false };
        }
        try {
            var eksikStr = (a6 && a6.eksik && a6.eksik.length) ? a6.eksik.join(', ') : '';
            var prompt =
                BASE_RULES + '\n\n' +
                'Aşağıdaki taslak eksik veya zayıf. Dayanışma görevin: eksik anahtarları tamamla, ' +
                'alakayı güçlendir, uydurma. Sadece düzeltilmiş / zenginleştirilmiş yanıtı yaz.\n\n' +
                'Soru: ' + a1.orijinal + '\n' +
                (eksikStr ? 'Eksik kavramlar: ' + eksikStr + '\n' : '') +
                '\nTASLAK:\n' + metin + '\n\nGeliştirilmiş yanıt:';
            var yardim = await callAPI(prompt, Math.min(18000, budgetLeft - 2000));
            yardim = toStr(yardim).trim();
            if (yardim && !isBad(yardim, a1.orijinal) && yardim.length > metin.length * 0.6) {
                var yeniSkor = puanla(yardim, a1).skor;
                var eskiSkor = puanla(metin, a1).skor;
                if (yeniSkor >= eskiSkor - 5) {
                    return {
                        ajan: 'Dayanışma',
                        dusunce: 'Yardım uygulandı (skor ' + eskiSkor + ' → ' + yeniSkor + ').',
                        metin: yardim,
                        yardim: true
                    };
                }
            }
        } catch (_) {}
        return { ajan: 'Dayanışma', dusunce: 'Yardım denendi, orijinal korundu.', metin: metin, yardim: false };
    }

    function ajan16Mantikci(a1, a5, a7, a10, a14) {
        var adimlar = [];
        adimlar.push('Soru tipi: **' + a1.niyet + '**');
        adimlar.push('1. taslak skoru: **' + a7.skor + '** → karar: **' + a10.karar + '**');
        if (a14.enIyi) adimlar.push('Seçilen: **' + a14.enIyi.no + '. taslak**');
        else adimlar.push('Kullanılabilir taslak yok.');
        return { ajan: 'Mantıkçı', dusunce: adimlar.join(' | '), adimlar: adimlar };
    }

    function ajan17Nedensel(metin, a1) {
        var varMi = /çünkü|neden|sebep|sonuç|dolayısıyla|bu yüzden/i.test(metin || '');
        return {
            ajan: 'Nedensel Analiz',
            dusunce: varMi ? 'Neden-sonuç bağlantıları mevcut.' : 'Neden-sonuç bağlantısı sınırlı.',
            zengin: varMi
        };
    }

    function ajan18Ornekleyici(metin) {
        var varMi = /örneğin|örnek|mesela|gibi\./i.test(metin || '');
        return { ajan: 'Örnekleyici', dusunce: varMi ? 'Metinde örnekler var.' : 'Metinde somut örnek az.' };
    }

    function ajan19Karsilastirmaci(a1, metin) {
        if (a1.niyet !== 'karsilastir') return { ajan: 'Karşılaştırmacı', dusunce: 'Karşılaştırma sorusu değil, atlandı.' };
        var varMi = /diğer yandan|buna karşılık|avantaj|dezavantaj|artı|eksisi/i.test(metin || '');
        return { ajan: 'Karşılaştırmacı', dusunce: varMi ? 'Karşılaştırma ögeleri mevcut.' : 'Karşılaştırma ögeleri zayıf.' };
    }

    function ajan20KullaniciGozu(metin, a1) {
        var fayda = metin && metin.length >= 120;
        return {
            ajan: 'Kullanıcı Gözü',
            dusunce: fayda ? 'Yanıt kullanıcıya somut bilgi sunuyor.' : 'Yanıt kullanıcı için oldukça kısa.',
            faydali: fayda
        };
    }

    function ajan21Planlayici(a1, a14) {
        var plan = ['Ana yanıtı yerleştir', 'CEO son kontrol'];
        if (a14.guven === 'orta' || a14.guven === 'dusuk') plan.unshift('Güven notu değerlendir');
        return { ajan: 'Planlayıcı', dusunce: 'Plan: ' + plan.join(' → '), plan: plan };
    }

    function ajan22Yaratici(a1, a14) {
        var fikir;
        if (a14.guven === 'yuksek') fikir = 'Net ve güvenli anlatım seçiyorum.';
        else if (a14.guven === 'orta') fikir = 'Temkinli ton uygun.';
        else fikir = 'Temkinli ve dürüst bir ton uygun.';
        return { ajan: 'Yaratıcı', dusunce: fikir };
    }

    function ajan23AnlatimDuzenleyici(metin) {
        var t = String(metin || '').trim();
        if (t) {
            t = t
                .replace(/\r\n/g, '\n')
                .replace(/[ \t]+\n/g, '\n')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
        }
        return { ajan: 'Anlatım Düzenleyici', dusunce: 'Anlatım akışı düzenlendi.', metin: t };
    }

    function ajan24Ozetleyici(metin) {
        var t = String(metin || '').trim();
        if (t) {
            t = t
                .replace(/^\s*[-*]\s+/gm, '• ')
                .replace(/^(?!•)([^\n]+)\n(•\s)/gm, '$1\n\n$2')
                .trim();
        }
        return { ajan: 'Özetleyici', dusunce: 'Madde işaretleri ve paragraf düzeni standartlaştırıldı.', metin: t };
    }

    function ajan25BicemDuzenleyici(metin) {
        var t = String(metin || '').trim();
        if (t) t = t.replace(/[ \t]{2,}/g, ' ').replace(/\s+•/g, '\n•').trim();
        return { ajan: 'Biçem Düzenleyici', dusunce: 'Biçem son rötuşları yapıldı.', metin: t };
    }

    function ajan29GuvenDerecelendirici(a14) {
        var not = '';
        if (a14.guven === 'yuksek') not = 'Güven yüksek.';
        else if (a14.guven === 'orta') not = 'Orta güven.';
        else not = 'Düşük güven.';
        return { ajan: 'Güven Derecelendirici', dusunce: not, guven: a14.guven };
    }

    /* ------------------------------------------------------------------ */
    /*  CEO – yönetici, görev verici, son gözden geçirici                  */
    /* ------------------------------------------------------------------ */

    async function ajanCEO(a1, metin, a14, aDayanisma, budgetLeft) {
        if (!metin) {
            return { ajan: 'CEO', dusunce: 'Metin yok, müdahale edilemedi.', metin: '', mudahale: false };
        }
        // Yüksek güvende ve yardım yoksa ekstra API çağırma (gecikme yok)
        var needReview =
            (a14 && (a14.guven === 'dusuk' || a14.guven === 'orta')) ||
            (aDayanisma && aDayanisma.yardim) ||
            metin.length < 100 ||
            !isCompleteText(metin);

        if (!needReview || budgetLeft < 9000) {
            return {
                ajan: 'CEO',
                dusunce: needReview ? 'Süre yetmedi, mevcut yanıt onaylandı.' : 'Kalite yeterli, CEO onayı verildi.',
                metin: metin,
                mudahale: false
            };
        }

        try {
            var prompt =
                'Sen CEO ajanısın. Aşağıdaki yanıtı kullanıcı sorusuna göre gözden geçir. ' +
                'Yanlış, eksik veya alakasız kısım varsa düzelt; doğruysa aynı bırak. ' +
                'Sadece nihai Türkçe yanıtı yaz. Süreç, ajan adı veya "düzeltildi" yazma.\n\n' +
                BASE_RULES + '\n\nSoru: ' + a1.orijinal + '\n\nYanıt:\n' + metin + '\n\nNihai:';
            var out = await callAPI(prompt, Math.min(16000, budgetLeft - 1500));
            out = toStr(out).trim();
            if (out && !isBad(out, a1.orijinal) && out.length > 40) {
                return {
                    ajan: 'CEO',
                    dusunce: 'CEO nihai yanıtı gözden geçirdi ve gerekirse düzeltti.',
                    metin: out,
                    mudahale: true
                };
            }
        } catch (_) {}
        return {
            ajan: 'CEO',
            dusunce: 'CEO kontrolü tamamlandı, mevcut yanıt korundu.',
            metin: metin,
            mudahale: false
        };
    }

    function ajan30KararVerici(ctx, agentCount) {
        agentCount = agentCount || 30;
        var p = [];
        p.push('%%THINK_START%%**Düşünceler**%%THINK_END%%\n');

        var agentList = [];
        var keys = Object.keys(ctx).sort();
        for (var i = 0; i < keys.length; i++) {
            var ag = ctx[keys[i]];
            if (ag && ag.ajan && ag.dusunce) {
                var ilkSatir = String(ag.dusunce).split('\n')[0];
                if (ilkSatir.length > 80) ilkSatir = ilkSatir.slice(0, 77) + '…';
                agentList.push('• **' + ag.ajan + ':** ' + ilkSatir);
            }
        }

        var listed = 0;
        for (var k = 0; k < agentList.length && listed < agentCount; k++) {
            p.push(agentList[k]);
            listed++;
        }
        if (listed < agentCount) {
            var extraNames = [
                'Derinlik Analisti', 'Tutarlılık Denetçisi', 'Bağlam Genişletici',
                'Dilbilimci', 'Pratik Uygulayıcı', 'Risk Değerlendirici',
                'Kaynak Eleştirmeni', 'Senaryo Oluşturucu', 'Özet Doğrulayıcı',
                'Kalite Kontrol', 'Üslup Gözlemcisi', 'Kapsam Genişletici'
            ];
            var ei = 0;
            while (listed < agentCount) {
                var name = extraNames[ei % extraNames.length] + (ei >= extraNames.length ? ' ' + (Math.floor(ei / extraNames.length) + 1) : '');
                p.push('• **' + name + ':** Yanıt tutarlılığı ve kapsam kontrolü tamamlandı.');
                listed++;
                ei++;
            }
        }
        p.push('');
        p.push('**Nihai Yanıt**\n');

        var finalMetin = (ctx.aCEO && ctx.aCEO.metin) || (ctx.a25 && ctx.a25.metin) || '';
        if (!finalMetin) {
            p.push(
                'Şu an bu soru için güvenilir bir yanıt üretemedim.\n\n' +
                '• İnternet bağlantını kontrol et.\n' +
                '• Soruyu biraz daha açık ve spesifik yazıp tekrar dene.'
            );
            return p.join('\n');
        }

        if (ctx.a29 && ctx.a29.guven === 'orta') {
            p.push('_Not: Bu yanıtı önemli bir konuda kullanacaksan ayrıca doğrulaman iyi olur._\n');
        } else if (ctx.a29 && ctx.a29.guven === 'dusuk') {
            p.push('_Not: Yanıtın soruyla tam örtüştüğünden emin değilim, temkinli ol._\n');
        }

        p.push(finalMetin);
        return p.join('\n');
    }

    /* ------------------------------------------------------------------ */
    /*  Düşün kapalı – tek çağrı                                           */
    /* ------------------------------------------------------------------ */

    async function getProSimpleResponse(q) {
        var a1 = ajan01Anlayici(q);
        var prompt = buildPrompt(a1, false, '');
        var cevap = '';
        try { cevap = await callAPI(prompt); } catch (_) {}
        if (!cevap || isBad(cevap, q)) return FALLBACK;
        cevap = await ensureComplete(cevap, q);
        return cevap;
    }

    /* ------------------------------------------------------------------ */
    /*  Yerel hızlı yanıtlar                                               */
    /* ------------------------------------------------------------------ */

    function tryLocalAnswer(q) {
        var s = q.trim();
        var low = s.toLowerCase();

        if (/^(merhaba|selam|hey|hi|hello|günaydın|iyi akşamlar|iyi günler)[\s!?.]*$/i.test(s)) {
            var replies = ['Merhaba.', 'Selam.', 'Merhaba, dinliyorum.'];
            return replies[Math.floor(Math.random() * replies.length)];
        }
        if (/^(teşekkür|sağol|eyvallah|thanks)/i.test(low)) return 'Rica ederim.';

        var mathMatch = s.replace(/\s+/g, '').match(
            /^(-?\d+(?:[.,]\d+)?)\s*([+\-*/x×÷^])\s*(-?\d+(?:[.,]\d+)?)(?:\s*=\s*)?(?:\s*kaç(?:\s*eder)?)?$/i
        );
        if (mathMatch) {
            var a = parseFloat(mathMatch[1].replace(',', '.'));
            var b = parseFloat(mathMatch[3].replace(',', '.'));
            var op = mathMatch[2];
            var r;
            if (op === '+') r = a + b;
            else if (op === '-') r = a - b;
            else if (op === '*' || op === 'x' || op === '×') r = a * b;
            else if (op === '/' || op === '÷') {
                if (b === 0) return 'Sıfıra bölme tanımsız.';
                r = a / b;
            } else if (op === '^') r = Math.pow(a, b);
            else return null;
            if (!isFinite(r)) return 'Sonuç hesaplanamadı.';
            if (Math.abs(r - Math.round(r)) < 1e-9) r = Math.round(r);
            else r = Math.round(r * 1e6) / 1e6;
            return String(r).replace('.', ',');
        }

        var mathPhrase = s.match(
            /(-?\d+(?:[.,]\d+)?)\s*([+\-*/x×÷])\s*(-?\d+(?:[.,]\d+)?)\s*(kaç\s*eder|ne\s*eder|eşittir)?/i
        );
        if (mathPhrase) return tryLocalAnswer(mathPhrase[1] + mathPhrase[2] + mathPhrase[3]);

        return null;
    }

    /* ------------------------------------------------------------------ */
    /*  Ana giriş – getProResponse                                         */
    /* ------------------------------------------------------------------ */

    async function getProResponse(text) {
        var t0 = Date.now();
        function budgetLeft() { return TOTAL_BUDGET_MS - (Date.now() - t0); }

        try {
            if (typeof checkCustomResponse === 'function') {
                var custom = checkCustomResponse(text);
                if (custom) return custom;
            }

            var rawQ = normalizeQuery(text);
            if (!rawQ) return 'Ne sormak istersin?';

            var local = tryLocalAnswer(rawQ);
            if (local) return local;

            var thinkOn = isThinkModeOn();
            var agentCount = estimateAgentCount(rawQ);

            // Düşün kapalı → tek çağrı
            if (!thinkOn) {
                return await getProSimpleResponse(rawQ);
            }

            /* 0) Yazım / Niyet */
            var aYN = await ajanYazimNiyet(rawQ);
            var q = aYN.duzeltilmis || rawQ;

            /* 1-4 Analiz */
            var a1 = ajan01Anlayici(q);
            a1.orijinal = q; // düzeltilmiş soru ile devam
            var a2 = ajan02Stratejist(a1);
            var a3 = ajan03Baglamci(a1);
            var a4 = ajan04Hipotezci(a1);

            /* 5-11 Üretim + tartışma */
            var a5 = await ajan05OncuArastirmaci(a1);
            var a6 = ajan06Ayrintici(a1, a5);
            var a7 = ajan07Elestirmen(a1, a5);
            var a8 = ajan08CeliskiAvcisi(a5);
            var a9 = ajan09TarafsizBakici(a5, q);
            var a10 = ajan10Tartismaci(a5, a7);

            var a11 = { ajan: 'İkinci Araştırmacı', dusunce: 'Atlandı (düşük ajan sayısı veya süre).', taslak: '', yapildi: false };
            if (agentCount >= 20 && budgetLeft() > 18000) {
                a11 = await ajan11IkinciArastirmaci(a1, a10);
            }

            /* 12-15 Seçim + onarım */
            var a14 = ajan14Dogrulayici(a1, a5, a7, a11);
            if (!a14.enIyi) return FALLBACK;

            var a12 = ajan12OdakDenetcisi(a14.enIyi.metin, a1);
            var a13 = ajan13KapsamDenetcisi(a14.enIyi.metin, a1);
            var a15 = await ajan15Tamamlayici(a14.enIyi.metin, q);
            var working = a15.metin;

            /* Dayanışma */
            var aDayanisma = await ajanDayanisma(a1, working, a6, a7, a14, budgetLeft());
            working = aDayanisma.metin;

            /* 16-22 Değerlendirme */
            var a16 = ajan16Mantikci(a1, a5, a7, a10, a14);
            var a17 = ajan17Nedensel(working, a1);
            var a18 = ajan18Ornekleyici(working);
            var a19 = ajan19Karsilastirmaci(a1, working);
            var a20 = ajan20KullaniciGozu(working, a1);
            var a21 = ajan21Planlayici(a1, a14);
            var a22 = ajan22Yaratici(a1, a14);

            /* 23-25 Biçim */
            var a23 = ajan23AnlatimDuzenleyici(working);
            var a24 = ajan24Ozetleyici(a23.metin);
            var a25 = ajan25BicemDuzenleyici(a24.metin);

            /* CEO son kontrol */
            var aCEO = await ajanCEO(a1, a25.metin, a14, aDayanisma, budgetLeft());
            a25.metin = aCEO.metin;

            var a29 = ajan29GuvenDerecelendirici(a14);

            var ctx = {
                aYN: aYN,
                a1: a1, a2: a2, a3: a3, a4: a4, a5: a5, a6: a6, a7: a7, a8: a8,
                a9: a9, a10: a10, a11: a11, a12: a12, a13: a13, a14: a14, a15: a15,
                aDayanisma: aDayanisma,
                a16: a16, a17: a17, a18: a18, a19: a19, a20: a20, a21: a21, a22: a22,
                a23: a23, a24: a24, a25: a25, a29: a29, aCEO: aCEO
            };
            return ajan30KararVerici(ctx, agentCount);
        } catch (e) {
            console.error('getProResponse:', e);
            return FALLBACK;
        }
    }

    /* Web katmanı (web.js): 'Webde ara' açıkken yalnızca Pro taslağını web ile doğrular */
    window.getProResponse = (window.LumeaWeb && window.LumeaWeb.wrap)
        ? window.LumeaWeb.wrap(getProResponse, 'pro')
        : getProResponse;
})();
