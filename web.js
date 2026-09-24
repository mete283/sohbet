/**
 * Lui Web 2.1 – "Webde ara" modülü (Lite + Pro ortak, modeller birbirine karışmaz)
 *
 * Tuş AÇIKKEN, yalnızca o anki model için:
 *  1) Soruya uygun arama ifadeleri → Vikipedi (TR/EN) + DuckDuckGo
 *  2) Model kendi taslağını web sonuçlarıyla karşılaştırır / düzeltir
 *  3) (İsteğe bağlı) Doğrulayıcı web ile son kontrol; gerekirse bir kez daha düzeltir
 *
 * Lite ve Pro birbirinin yanıtına karışmaz; çapraz model çağrısı yok.
 * Kullanıcıya "web bulunamadı" vb. dipnot / reklam metni gösterilmez.
 * Kaynak linkleri gösterilmez.
 *
 * window.LumeaWeb: isOn(), setOn(bool), search(q), apply(q, metin, model), wrap(fn, model)
 */
(function () {
    'use strict';

    var WEB_KEY = 'lumea-web-mode';
    var FAIL_MSG = 'Şu an yanıt üretemedim';
    var MARK_FINAL = '**Nihai Yanıt**';
    var TOTAL_BUDGET_MS = 75000; // toplam süre aşılırsa son doğrulama atlanır

    /* ---------------- Tuş durumu ---------------- */

    function isOn() {
        try {
            var v = localStorage.getItem(WEB_KEY);
            return v === '1' || v === 'true';
        } catch (_) { return false; }
    }
    function setOn(on) {
        try { localStorage.setItem(WEB_KEY, on ? '1' : '0'); } catch (_) {}
    }

    /* ---------------- Yardımcılar ---------------- */

    var STOP = {
        bir:1, bu:1, şu:1, o:1, ve:1, ile:1, için:1, gibi:1, daha:1, çok:1,
        olan:1, olarak:1, kadar:1, sonra:1, önce:1, ise:1, de:1, da:1, ki:1,
        mi:1, mı:1, mu:1, mü:1, ne:1, nasıl:1, neden:1, nedir:1, hangi:1,
        her:1, hiç:1, ya:1, veya:1, ama:1, fakat:1, çünkü:1, eğer:1,
        var:1, yok:1, şey:1, en:1, hem:1, sadece:1, anlat:1, söyle:1,
        bana:1, bilgi:1, hakkında:1, kimdir:1, kaç:1, nerede:1, kim:1,
        the:1, and:1, for:1, with:1, what:1, who:1, how:1, is:1, are:1
    };

    function keyWords(q) {
        return String(q || '')
            .toLowerCase()
            .replace(/[?!.,;:()"'“”]/g, ' ')
            .split(/\s+/)
            .filter(function (w) { return w.length > 2 && !STOP[w]; });
    }
    function keyQuery(q) {
        var w = keyWords(q).slice(0, 6).join(' ');
        return w || String(q || '').trim();
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

    function toStr(v) {
        if (v == null) return '';
        if (typeof v === 'string') return v;
        if (typeof v === 'number' || typeof v === 'boolean') return String(v);
        return '';
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

    async function callAPI(promptText, timeoutMs) {
        var res = await withTimeout(
            timeoutMs || 25000,
            fetch('https://devtoolbox-api.devtoolbox-api.workers.dev/ai/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: promptText })
            })
        );
        if (!res.ok) throw new Error('http_' + res.status);
        var data = await res.json();
        return extractText(data).trim();
    }

    function clip(s, n) {
        s = String(s || '').replace(/\s+/g, ' ').trim();
        return s.length > n ? s.slice(0, n - 1) + '…' : s;
    }

    /* ---------------- Web araması ---------------- */

    async function wikiSearch(lang, query) {
        var url = 'https://' + lang + '.wikipedia.org/w/api.php' +
            '?action=query&generator=search&gsrlimit=4&prop=extracts&exintro=1&explaintext=1' +
            '&exlimit=4&exchars=1500&format=json&origin=*' +
            '&gsrsearch=' + encodeURIComponent(query);
        var res = await withTimeout(8000, fetch(url));
        if (!res.ok) throw new Error('http_' + res.status);
        var data = await res.json();
        var pages = data && data.query && data.query.pages
            ? Object.keys(data.query.pages).map(function (k) { return data.query.pages[k]; })
            : [];
        pages.sort(function (a, b) { return (a.index || 0) - (b.index || 0); });
        return pages.filter(function (p) { return p.extract; }).map(function (p) {
            return { title: p.title, src: 'Vikipedi ' + lang.toUpperCase(), text: clip(p.extract, 1400) };
        });
    }

    async function ddgSearch(query) {
        var url = 'https://api.duckduckgo.com/?format=json&no_html=1&skip_disambig=1&q=' +
            encodeURIComponent(query);
        var res = await withTimeout(8000, fetch(url));
        if (!res.ok) throw new Error('http_' + res.status);
        var d = await res.json();
        var out = [];
        if (d.AbstractText) {
            out.push({ title: d.Heading || query, src: 'DuckDuckGo', text: clip(d.AbstractText, 1400) });
        }
        (d.RelatedTopics || []).slice(0, 3).forEach(function (r) {
            if (r && r.Text) out.push({ title: 'İlgili konu', src: 'DuckDuckGo', text: clip(r.Text, 400) });
        });
        return out;
    }

    /** Yapay zekâdan arama ifadeleri üret (başarısızsa anahtar kelimeler) */
    async function makeQueries(q) {
        var list = [keyQuery(q)];
        try {
            var r = await callAPI(
                'Aşağıdaki soruyu Vikipedi\'de aratmak için 1-3 kısa arama ifadesi yaz. ' +
                'Konu adını ve özel isimleri kullan; gerekirse İngilizce karşılığını da ekle. ' +
                'Her satıra bir ifade yaz, başka hiçbir şey yazma.\n\nSoru: ' + q + '\n\nİfadeler:',
                9000
            );
            r.split('\n').forEach(function (line) {
                line = line.replace(/^[\s\-•*\d.)]+/, '').replace(/["“”]/g, '').trim();
                if (line && line.length < 80 && list.indexOf(line) === -1 && list.length < 4) list.push(line);
            });
        } catch (_) {}
        return list;
    }

    function relevance(res, q) {
        var stems = keyWords(q).map(function (w) { return w.slice(0, 5); });
        if (!stems.length) return 0.3;
        var title = res.title.toLowerCase();
        var text = res.text.toLowerCase();
        var score = 0;
        stems.forEach(function (s) {
            if (title.indexOf(s) !== -1) score += 2;
            else if (text.indexOf(s) !== -1) score += 1;
        });
        return score / (stems.length * 2);
    }

    async function search(q, queriesIn) {
        var queries = queriesIn || await makeQueries(q);
        var jobs = [];
        queries.forEach(function (qq) {
            jobs.push(wikiSearch('tr', qq).catch(function () { return []; }));
        });
        jobs.push(ddgSearch(queries[0]).catch(function () { return []; }));
        var groups = await Promise.all(jobs);
        var all = [].concat.apply([], groups);

        // TR'de yeterli sonuç yoksa İngilizce Vikipedi
        if (all.length < 2) {
            for (var i = 0; i < Math.min(2, queries.length); i++) {
                try { all = all.concat(await wikiSearch('en', queries[i])); } catch (_) {}
            }
        }

        var seen = {};
        var scored = [];
        all.forEach(function (r) {
            var key = (r.src + '|' + r.title).toLowerCase();
            if (seen[key]) return;
            seen[key] = 1;
            r.score = relevance(r, q);
            scored.push(r);
        });
        scored.sort(function (a, b) { return b.score - a.score; });
        var good = scored.filter(function (r, idx) { return r.score >= 0.25 || idx === 0 && r.score > 0; });
        return good.slice(0, 4);
    }

    function evidenceBlock(results) {
        return results.map(function (r, i) {
            return '[' + (i + 1) + '] ' + r.title + ' (' + r.src + '): ' + r.text;
        }).join('\n');
    }

    /* ---------------- Model kişilikleri ---------------- */

    var FORMAT_RULES =
        'Tamamen Türkçe yaz. Kendini veya bir ürünü tanıtma. Uydurma bilgi verme; emin olmadığını kesin gibi yazma.\n' +
        'Biçim: mantıklı parçalara böl, ana başlığı ve önemli kelimeleri **kalın** yaz, ' +
        'liste maddelerini satır başında "• " ile başlat, paragraflar arasında boş satır bırak. ' +
        'Son cümleyi mutlaka noktalama işaretiyle bitir. Yanıtta kaynak numarası, link veya "web sonuçlarına göre" gibi ifade kullanma.';

    var PERSONA = {
        lite: 'Sen Lui Lite\'sın: net, anlaşılır ve öz ama eksiksiz yanıt verirsin.',
        pro: 'Sen Lui Pro\'sun: ayrıntılı, temkinli ve mantık hatalarına karşı dikkatli yanıt verirsin.'
    };

    /* ---------------- Ana akış ---------------- */

    function splitResponse(text) {
        var idx = text.lastIndexOf(MARK_FINAL);
        if (idx === -1) return { head: '', answer: text.trim() };
        return { head: text.slice(0, idx), answer: text.slice(idx + MARK_FINAL.length).trim() };
    }
    function stripNotes(a) {
        return String(a || '')
            .replace(/^_Not:[^\n]*\n*/gm, '')
            .replace(/\n*_Web'de ilgili sonuç[^\n]*_?\s*$/gi, '')
            .replace(/\n*_Web’de ilgili sonuç[^\n]*_?\s*$/gi, '')
            .trim();
    }
    function looksBad(t) { return !t || t.length < 20 || t.indexOf(FAIL_MSG) !== -1; }

    /** Modelin süreç metnini/kaynak işaretlerini yanıttan temizle */
    function cleanFinal(t) {
        t = String(t || '')
            .replace(/\s*\[\d+(?:\s*[,;]\s*\d+)*\]/g, '')
            .replace(/https?:\/\/\S+/g, '')
            .split('\n')
            .filter(function (l) {
                return !/^\s*(TASLAK|DENETİM|WEB SONUÇLARI|Nihai yanıt\s*:?)/i.test(l)
                    && !/Web'de ilgili sonuç bulunamadı/i.test(l)
                    && !/çapraz kontrol/i.test(l);
            })
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        if (!/[.!?…)\]"'”*]\s*$/.test(t)) {
            var cut = Math.max(t.lastIndexOf('.'), t.lastIndexOf('!'), t.lastIndexOf('?'));
            if (cut > t.length * 0.5) t = t.slice(0, cut + 1);
        }
        return t;
    }

    async function apply(question, fullText, model) {
        try {
            if (!isOn()) return fullText;
            var text = String(fullText || '');
            if (!text || text.indexOf(FAIL_MSG) !== -1) return text;
            if (typeof window.checkCustomResponse === 'function' && window.checkCustomResponse(question)) return text;

            var parts = splitResponse(text);
            var own = stripNotes(parts.answer);
            if (own.length < 40) return text;

            var t0 = Date.now();
            var q = String(question || '').trim();
            var me = model === 'pro' ? 'pro' : 'lite';

            // 1) Yalnızca web araması (diğer modele asla dokunulmaz)
            var results = [];
            try { results = await search(q); } catch (_) { results = []; }
            var hasWeb = results.length > 0;
            var ev = hasWeb ? evidenceBlock(results) : '';

            // Web yoksa orijinal yanıtı olduğu gibi döndür (dipnot yok, başka model yok)
            if (!hasWeb) {
                var outNoWeb = '';
                if (parts.head) outNoWeb += parts.head.replace(/\s+$/, '') + '\n' + MARK_FINAL + '\n';
                outNoWeb += own;
                return outNoWeb;
            }

            // 2) Tek model: kendi taslağını web ile karşılaştırıp düzelt
            var finalAns = '';
            try {
                finalAns = await callAPI(
                    PERSONA[me] + '\n' + FORMAT_RULES + '\n\n' +
                    'Aşağıda bir soru, senin taslağın ve web sonuçları var. Kurallar:\n' +
                    '• Web sonuçlarıyla çelişen bilgiyi web\'e göre düzelt.\n' +
                    '• Eksik önemli bilgiyi web\'den tamamla.\n' +
                    '• Web ile uyumlu kısımları koru.\n' +
                    '• Denetimi, taslağı veya süreci yanıtta anma; yalnızca soruya yanıt ver.\n' +
                    '• "Web sonuçlarına göre", kaynak numarası veya link yazma.\n\n' +
                    'WEB SONUÇLARI:\n' + ev + '\n\nSoru: ' + q + '\n\n' +
                    'TASLAK:\n' + own + '\n\nNihai yanıt:',
                    30000
                );
            } catch (_) { finalAns = ''; }
            finalAns = looksBad(finalAns) ? own : cleanFinal(finalAns);
            if (looksBad(finalAns)) finalAns = own;

            // 3) Doğrulayıcı: yalnızca web varken, süre bütçesi içinde
            if (hasWeb && Date.now() - t0 < TOTAL_BUDGET_MS) {
                try {
                    var v = await callAPI(
                        'Sen bir doğrulayıcısın. Aşağıdaki YANIT\'ta web sonuçlarıyla ÇELİŞEN ya da web\'de desteği olmayan ' +
                        'şüpheli bir bilgi var mı? Yoksa yalnızca "TAMAM" yaz. Varsa her sorunu tek satırda ' +
                        '"SORUN: ... (doğrusu: ...)" biçiminde yaz. En fazla 5 satır.\n\n' +
                        'WEB SONUÇLARI:\n' + ev + '\n\nSoru: ' + q + '\n\nYANIT:\n' + finalAns + '\n\nSonuç:',
                        20000
                    );
                    if (!/^\s*TAMAM/i.test(v) && /SORUN\s*:/i.test(v)) {
                        var fixed = await callAPI(
                            PERSONA[me] + '\n' + FORMAT_RULES + '\n\n' +
                            'Aşağıdaki yanıtı, doğrulayıcının bulduğu sorunlara göre düzelt. ' +
                            'Sorunla ilgisiz kısımları değiştirme. Sadece düzeltilmiş yanıtı yaz.\n\n' +
                            'WEB SONUÇLARI:\n' + ev + '\n\nSoru: ' + q + '\n\nYANIT:\n' + finalAns +
                            '\n\nSORUNLAR:\n' + v + '\n\nDüzeltilmiş yanıt:',
                            30000
                        );
                        fixed = cleanFinal(fixed);
                        if (!looksBad(fixed)) finalAns = fixed;
                    }
                } catch (_) {}
            }

            // 4) Çıktı — kaynak linki yok, dipnot yok, çapraz model yok
            var out = '';
            if (parts.head) {
                var srcNames = [];
                results.forEach(function (r) { if (srcNames.indexOf(r.src) === -1) srcNames.push(r.src); });
                var webLine = '• **Web Ajanı:** ' + results.length + ' ilgili sonuç kullanıldı.\n';
                out += parts.head.replace(/\s+$/, '') + '\n' + webLine + '\n' + MARK_FINAL + '\n';
            }
            out += finalAns.trim();
            return out;
        } catch (e) {
            console.error('LumeaWeb.apply:', e);
            return fullText;
        }
    }

    function wrap(fn, model) {
        return async function (text) {
            var res = await fn(text);
            if (!isOn()) return res;
            return apply(text, res, model);
        };
    }

    window.LumeaWeb = { KEY: WEB_KEY, isOn: isOn, setOn: setOn, search: search, apply: apply, wrap: wrap };
})();
