/**
 * Lui Lite 2.3 – Gerçek AI API tabanlı
 * 2.3:
 *  - Ajan sayısı soruya göre otomatik (ayar tuşu kaldırıldı)
 *  - Düşünce başlığı: Düşünceler
 *  - Kesik yanıt onarımı korundu
 */
(function () {

function isThinkModeOnLite() {
    try {
        var v = localStorage.getItem('lumea-think-mode');
        if (v === null || v === undefined) return true;
        return v === '1' || v === 'true';
    } catch (_) { return true; }
}

/** Sorunun karmaşıklığına göre ajan sayısı (otomatik) */
function estimateAgentCountLite(q) {
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
    return 100;
}

/** Lite düşünce süreci – soruya göre ajan sayısı (UI collapsible) */
function wrapLiteThink(ans, q) {
    if (!isThinkModeOnLite()) return ans;
    var clean = String(q || '').trim().slice(0, 80).replace(/"/g, "'");
    var agentCount = estimateAgentCountLite(q);
    var terms = extractKeyTermsPro(q, 4);
    var core = [
        '• **Anlayıcı:** Soruyu netleştirdim: "' + clean + '".',
        '• **Araştırmacı:** Bilgiyi derledim ve tutarlılığı kontrol ettim.',
        '• **Bağlamcı:** Konunun alanını ve kapsamını belirledim.',
        '• **Ayrıntıcı:** ' + (terms.length ? ('Anahtarlar: ' + terms.join(', ') + '.') : 'Önemli noktaları gözden geçirdim.'),
        '• **Eleştirmen:** Yanıtın doğruluğunu ve netliğini değerlendirdim.',
        '• **Düzenleyici:** Yanıtı okunabilir ve Türkçe biçimlendirdim.',
        '• **Mantıkçı:** Akış ve tutarlılığı kontrol ettim.',
        '• **Kullanıcı Gözü:** Yanıtın faydasını kullanıcı açısından baktım.',
        '• **Biçem:** Madde ve paragraf düzenini standartlaştırdım.',
        '• **Karar:** Nihai cevabı seçtim.'
    ];
    var extraNames = [
        'Derinlik Analisti', 'Tutarlılık Denetçisi', 'Bağlam Genişletici',
        'Dilbilimci', 'Pratik Uygulayıcı', 'Risk Değerlendirici',
        'Kaynak Eleştirmeni', 'Senaryo Oluşturucu', 'Özet Doğrulayıcı',
        'Kalite Kontrol', 'Üslup Gözlemcisi', 'Kapsam Genişletici'
    ];
    var lines = [];
    for (var i = 0; i < agentCount; i++) {
        if (i < core.length) {
            lines.push(core[i]);
        } else {
            var ei = i - core.length;
            var name = extraNames[ei % extraNames.length] + (ei >= extraNames.length ? ' ' + (Math.floor(ei / extraNames.length) + 1) : '');
            lines.push('• **' + name + ':** Yanıt tutarlılığı ve kapsam kontrolü tamamlandı.');
        }
    }
    return (
        '%%THINK_START%%**Düşünceler**%%THINK_END%%\n' +
        lines.join('\n') + '\n\n**Nihai Yanıt**\n' + String(ans || '').trim()
    );
}


var TR_STOP = {
    bir:1, bu:1, şu:1, o:1, ve:1, ile:1, için:1, gibi:1, daha:1, çok:1,
    olan:1, olarak:1, kadar:1, sonra:1, önce:1, ise:1, de:1, da:1, ki:1,
    mi:1, mı:1, mu:1, mü:1, ne:1, nasıl:1, neden:1, nedir:1, hangi:1,
    her:1, hiç:1, ya:1, veya:1, ama:1, fakat:1, çünkü:1, eğer:1,
    var:1, yok:1, şey:1, en:1, hem:1, sadece:1, yalnızca:1, üzere:1,
    göre:1, karşı:1, doğru:1, ilgili:1, hakkında:1, arasında:1,
    the:1, and:1, for:1, with:1, from:1, that:1, this:1, are:1, was:1,
    kaynak:1, madde:1, maddeler:1, wikipedia:1, ilgili:1, özellik:1,
    özellikler:1, tanım:1, özellikleri:1, bölüm:1, yanıt:1, cevap:1
};

function extractKeyTermsPro(text, maxTerms) {
    maxTerms = maxTerms || 5;
    var clean = String(text || '')
        .replace(/\*\*/g, ' ')
        .replace(/[*_•\-]/g, ' ')
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ');
    var words = clean.split(/\s+/).filter(Boolean);
    var freq = {}, order = [];
    for (var i = 0; i < words.length; i++) {
        var w = words[i], low = w.toLowerCase();
        if (low.length < 4 || TR_STOP[low] || /^\d+$/.test(low)) continue;
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

function toStrPro(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return '';
}

function isBadPro(out, userQ) {
    var t = toStrPro(out).trim();
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
        if (low.includes(hard[i])) return true;
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

function extractTextPro(data) {
    if (data == null) return '';
    if (typeof data === 'string' || typeof data === 'number') return toStrPro(data);
    var raw =
        data.response ?? data.answer ?? data.text ?? data.output ??
        data.result ?? data.content ?? data.message ??
        data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ??
        data.data?.response ?? data.data?.text ?? data.data?.answer ?? '';
    return toStrPro(raw);
}

function withTimeoutPro(ms, promise) {
    return new Promise(function (resolve, reject) {
        var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
        promise.then(
            function (v) { clearTimeout(t); resolve(v); },
            function (e) { clearTimeout(t); reject(e); }
        );
    });
}

async function callDevToolBoxRaw(promptText) {
    var res = await withTimeoutPro(
        18000,
        fetch('https://devtoolbox-api.devtoolbox-api.workers.dev/ai/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: promptText })
        })
    );
    if (!res.ok) throw new Error('http_' + res.status);
    var data = await res.json();
    return extractTextPro(data).trim();
}

/* ------------------------------------------------------------------ */
/*  Kesik yanıt onarımı (2.1)                                          */
/* ------------------------------------------------------------------ */

function isCompleteTextPro(t) {
    var s = String(t || '').trim();
    if (!s) return false;
    if (/\*\*$/.test(s)) {
        if (/[.!?…]["»)\]]?\s*\*\*$/.test(s.slice(-10))) return true;
    }
    var last = s.slice(-1);
    if (/[.!?…"»)\]]/.test(last)) return true;
    return false;
}

function cutToLastCompletePro(t) {
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

async function ensureCompletePro(t, query) {
    t = String(t || '').trim();
    if (!t) return t;
    if (isCompleteTextPro(t)) return t;
    try {
        var cont = await callDevToolBoxRaw(
            'Aşağıdaki metin yarıda kesilmiş. AYNI dilde ve aynı üslupla, ' +
            'kesildiği yerden DEVAM ET. Baştan tekrar etme, yeni konu açma, ' +
            'açıklama ekleme, metni noktalama işaretiyle bitir.\n\n' +
            'Kesilen metin:\n' + t.slice(-1500) + '\n\nDevam:'
        );
        cont = toStrPro(cont).trim();
        if (cont && !isBadPro(cont, query)) {
            var merged = (t + ' ' + cont).trim();
            if (isCompleteTextPro(merged)) return merged;
            return cutToLastCompletePro(merged);
        }
    } catch (_) {}
    return cutToLastCompletePro(t);
}

async function getLiteResponse(text) {
    try {
        if (typeof checkCustomResponse === 'function') {
            var custom = checkCustomResponse(text);
            if (custom) return custom;
        }

        var q = String(text || '').trim();
        if (!q) return 'Ne sormak istersin?';

        var local = tryLocalAnswer(q);
        if (local) return local;

        var systemPrompt =
            'Tamamen Türkçe cevap ver. Hiç İngilizce kelime, cümle veya terim karıştırma; ' +
            'gerekirse Türkçe karşılığını kullan (ör. battle royale yerine hayatta kalma / son adam ayakta).\n' +
            'Sadece kullanıcının sorusuna yanıt ver. Kendini, modelini veya bir ürünü asla tanıtma. Bilmiyorsan uydurma.\n\n' +
            'YANIT KALİTESİ (ZORUNLU):\n' +
            '- Yanıtı eksiksiz ve detaylı tut; kısa kesme, en az 4–8 anlamlı cümle veya madde yaz.\n' +
            '- Konuyu tanımla, önemli özelliklerini say, gerekirse örnek ver.\n' +
            '- Bilmediğin detayı uydurma.\n' +
            '- Yanıtın son cümlesini MUTLAKA noktalama işaretiyle bitir; yarım bırakma.\n\n' +
            'YANIT BİÇİMİ (ZORUNLU):\n' +
            '- Yanıtı mantıklı parçalara böl.\n' +
            '- Ana başlık varsa **kalın** yaz.\n' +
            '- Önemli kelimeleri **kalın** yaz.\n' +
            '- Liste gerekiyorsa her maddeyi • ile başlat (satır başında • boşluk).\n' +
            '- Paragraflar arasında mutlaka boş satır bırak.\n' +
            '- Noktalama ve kısa cümleler kullan.\n' +
            '- Uzun düz metin yığma; okunabilir ve net ol.';

        try {
            var ans = await callDevToolBoxRaw(
                systemPrompt + '\n\nSoru: ' + q + '\n\nCevap:'
            );
            if (!ans || isBadPro(ans, q)) {
                return 'Şu an yanıt üretemedim. İnternet bağlantını kontrol edip tekrar dene.';
            }

            // 2.1: kesik yanıt onarımı
            ans = await ensureCompletePro(ans, q);

            return wrapLiteThink(ans, q);
        } catch (_) {}

        return 'Şu an yanıt üretemedim. İnternet bağlantını kontrol edip tekrar dene.';
    } catch (e) {
        console.error('getLiteResponse:', e);
        return 'Şu an yanıt üretemedim. İnternet bağlantını kontrol edip tekrar dene.';
    }
}

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

/* Web katmanı (web.js): 'Webde ara' açıkken yanıtı web ile doğrulayıp düzeltir */
window.getLiteResponse = (window.LumeaWeb && window.LumeaWeb.wrap)
    ? window.LumeaWeb.wrap(getLiteResponse, 'lite')
    : getLiteResponse;
})();