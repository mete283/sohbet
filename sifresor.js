/**
 * Lui PIN kilidi – sifresor.js
 * Ayarlarda PIN açıksa ve kayıtlıysa, sohbet ekranı açılmadan
 * doğrulama ister. Tema açık/koyu uyumlu.
 * "Şifremi unuttum" → onay sonrası tüm Lumea verileri silinir.
 */
(function () {
  'use strict';

  var ENABLED = 'lumea-pin-enabled';
  var HASH = 'lumea-pin-hash';
  var LEN = 'lumea-pin-len';
  var UNLOCK_SESSION = 'lumea-pin-unlocked';
  var THEME_KEY = 'lumea-theme';
  var PREFIX = 'lumea-';

  function simpleHash(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
    return 'p' + (h >>> 0).toString(16);
  }

  function isDarkTheme() {
    try {
      return localStorage.getItem(THEME_KEY) === 'dark';
    } catch (_) {
      return false;
    }
  }

  function needsLock() {
    try {
      if (localStorage.getItem(ENABLED) !== '1') return false;
      if (!localStorage.getItem(HASH)) return false;
      if (sessionStorage.getItem(UNLOCK_SESSION) === '1') return false;
      return true;
    } catch (_) {
      return false;
    }
  }

  function unlock() {
    try { sessionStorage.setItem(UNLOCK_SESSION, '1'); } catch (_) {}
  }

  function pinLen() {
    var n = parseInt(localStorage.getItem(LEN) || '4', 10);
    return n === 6 ? 6 : 4;
  }

  /** Tüm Lumea verilerini sil (sohbetler, ayarlar, PIN, önbellek) */
  function clearAllData() {
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(PREFIX) === 0) keys.push(k);
      }
      keys.forEach(function (k) { localStorage.removeItem(k); });
    } catch (_) {}
    try { sessionStorage.clear(); } catch (_) {}
    if (window.caches && caches.keys) {
      caches.keys().then(function (ks) {
        return Promise.all(ks.map(function (k) { return caches.delete(k); }));
      }).catch(function () {});
    }
  }

  function mountGate() {
    if (document.getElementById('lui-pin-gate')) return;

    var dark = isDarkTheme();
    var bg = dark ? '#0a0a0c' : '#f4f5f8';
    var text = dark ? '#f2f2f7' : '#1c1c1e';
    var muted = '#8e8e93';
    var inputBg = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
    var inputBorder = dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';
    var btnBg = dark ? '#1c1c1e' : '#ffffff';
    var btnShadow = dark
      ? '0 8px 28px rgba(0,0,0,0.45),inset 0 1px 0 rgba(255,255,255,0.08)'
      : '0 4px 16px rgba(0,0,0,0.08),inset 0 1px 0 rgba(255,255,255,0.9)';
    var accent = dark ? '#0a84ff' : '#007aff';
    var danger = dark ? '#ff453a' : '#ff3b30';
    var modalBg = dark ? 'rgba(28,28,34,0.98)' : 'rgba(255,255,255,0.98)';
    var modalBorder = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
    var cancelBg = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
    var dangerBg = dark ? 'rgba(255,69,58,0.16)' : 'rgba(255,59,48,0.12)';

    var style = document.createElement('style');
    style.id = 'lui-pin-gate-style';
    style.textContent =
      '#lui-pin-gate{position:fixed;inset:0;z-index:99999;background:' + bg + ';display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;}' +
      '#lui-pin-gate .pg-brand{font-size:28px;font-weight:700;color:' + text + ';letter-spacing:-0.04em;margin-bottom:8px;}' +
      '#lui-pin-gate .pg-sub{font-size:14px;color:' + muted + ';margin-bottom:28px;}' +
      '#lui-pin-gate .pg-input{width:min(260px,80vw);height:52px;border-radius:16px;border:1px solid ' + inputBorder + ';background:' + inputBg + ';color:' + text + ';font-size:24px;font-weight:600;letter-spacing:0.4em;text-align:center;outline:none;-webkit-user-select:text;user-select:text;}' +
      '#lui-pin-gate .pg-input::placeholder{letter-spacing:0.05em;font-size:14px;font-weight:500;color:' + muted + ';}' +
      '#lui-pin-gate .pg-err{min-height:22px;margin-top:12px;font-size:13px;color:' + danger + ';font-weight:500;opacity:0;transition:opacity .2s;}' +
      '#lui-pin-gate .pg-err.show{opacity:1;}' +
      '#lui-pin-gate .pg-btn{margin-top:22px;width:64px;height:64px;border-radius:32px;border:none;background:' + btnBg + ';box-shadow:' + btnShadow + ';display:flex;align-items:center;justify-content:center;cursor:pointer;transition:transform .15s ease,background .15s;}' +
      '#lui-pin-gate .pg-btn:active{transform:scale(0.92);}' +
      '#lui-pin-gate .pg-btn svg{width:28px;height:28px;stroke:' + text + ';fill:none;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round;}' +
      '#lui-pin-gate .pg-btn.ok{background:#30d158;}' +
      '#lui-pin-gate .pg-btn.ok svg{stroke:#fff;}' +
      '#lui-pin-gate .pg-forgot{margin-top:28px;background:none;border:none;color:' + accent + ';font-size:14px;font-weight:600;cursor:pointer;padding:8px 12px;-webkit-tap-highlight-color:transparent;}' +
      '#lui-pin-gate .pg-forgot:active{opacity:0.7;}' +
      '#lui-pin-forget-modal{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.45);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px;opacity:0;pointer-events:none;transition:opacity .22s ease;}' +
      '#lui-pin-forget-modal.active{opacity:1;pointer-events:auto;}' +
      '#lui-pin-forget-modal .fm-card{width:min(320px,90vw);background:' + modalBg + ';border-radius:26px;padding:22px 20px 18px;text-align:center;border:1px solid ' + modalBorder + ';box-shadow:0 16px 40px rgba(0,0,0,0.18);transform:scale(0.92) translateY(8px);transition:transform .22s cubic-bezier(0.175,0.885,0.32,1.275);}' +
      '#lui-pin-forget-modal.active .fm-card{transform:scale(1) translateY(0);}' +
      '#lui-pin-forget-modal .fm-icon{width:46px;height:46px;border-radius:23px;background:' + dangerBg + ';display:flex;align-items:center;justify-content:center;margin:0 auto 12px;}' +
      '#lui-pin-forget-modal .fm-icon svg{width:22px;height:22px;stroke:' + danger + ';fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}' +
      '#lui-pin-forget-modal .fm-title{font-size:17px;font-weight:650;margin-bottom:6px;color:' + text + ';}' +
      '#lui-pin-forget-modal .fm-desc{font-size:13px;color:' + muted + ';line-height:1.45;margin-bottom:18px;}' +
      '#lui-pin-forget-modal .fm-actions{display:flex;gap:10px;}' +
      '#lui-pin-forget-modal .fm-btn{flex:1;height:42px;border-radius:14px;border:none;font-size:14px;font-weight:600;cursor:pointer;}' +
      '#lui-pin-forget-modal .fm-btn:active{transform:scale(0.96);}' +
      '#lui-pin-forget-modal .fm-cancel{background:' + cancelBg + ';color:' + text + ';}' +
      '#lui-pin-forget-modal .fm-danger{background:' + danger + ';color:#ffffff;}' +
      'html,body.lui-pin-locked{overflow:hidden!important;}';
    document.head.appendChild(style);

    var gate = document.createElement('div');
    gate.id = 'lui-pin-gate';
    gate.setAttribute('role', 'dialog');
    gate.setAttribute('aria-modal', 'true');
    gate.innerHTML =
      '<div class="pg-brand">Lui</div>' +
      '<div class="pg-sub">PIN gir</div>' +
      '<input class="pg-input" id="lui-pin-input" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="••••">' +
      '<div class="pg-err" id="lui-pin-err">Şifre hatalı</div>' +
      '<button type="button" class="pg-btn" id="lui-pin-ok" aria-label="Onayla">' +
      '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>' +
      '</button>' +
      '<button type="button" class="pg-forgot" id="lui-pin-forgot">Şifremi unuttum</button>';
    document.body.appendChild(gate);
    document.body.classList.add('lui-pin-locked');

    var modal = document.createElement('div');
    modal.id = 'lui-pin-forget-modal';
    modal.innerHTML =
      '<div class="fm-card">' +
      '<div class="fm-icon"><svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>' +
      '<div class="fm-title">Tüm veriler silinsin mi?</div>' +
      '<div class="fm-desc">Şifreni unuttuysan uygulamaya erişmek için tüm verilerin silinmesi gerekir. Sohbetler, ayarlar, renkler ve PIN kalıcı olarak silinir. Bu işlem geri alınamaz.</div>' +
      '<div class="fm-actions">' +
      '<button type="button" class="fm-btn fm-cancel" id="lui-pin-forget-no">Vazgeç</button>' +
      '<button type="button" class="fm-btn fm-danger" id="lui-pin-forget-yes">Tümünü sil</button>' +
      '</div></div>';
    document.body.appendChild(modal);

    var input = document.getElementById('lui-pin-input');
    var err = document.getElementById('lui-pin-err');
    var btn = document.getElementById('lui-pin-ok');
    var forgotBtn = document.getElementById('lui-pin-forgot');
    var forgetNo = document.getElementById('lui-pin-forget-no');
    var forgetYes = document.getElementById('lui-pin-forget-yes');
    var len = pinLen();
    input.maxLength = len;
    input.placeholder = len === 6 ? '••••••' : '••••';

    input.addEventListener('input', function () {
      input.value = input.value.replace(/\D/g, '').slice(0, len);
      err.classList.remove('show');
    });

    function tryUnlock() {
      var v = input.value;
      if (v.length !== len) {
        err.textContent = len + ' haneli PIN gir';
        err.classList.add('show');
        return;
      }
      var stored = localStorage.getItem(HASH);
      if (simpleHash(v) === stored) {
        btn.classList.add('ok');
        unlock();
        setTimeout(function () {
          teardown();
        }, 220);
      } else {
        err.textContent = 'Şifre hatalı';
        err.classList.add('show');
        input.value = '';
        input.focus();
        try { if (navigator.vibrate) navigator.vibrate([40, 40, 40]); } catch (_) {}
      }
    }

    function teardown() {
      gate.remove();
      modal.remove();
      style.remove();
      document.body.classList.remove('lui-pin-locked');
    }

    function openForgetModal() {
      modal.classList.add('active');
    }
    function closeForgetModal() {
      modal.classList.remove('active');
    }

    btn.addEventListener('click', tryUnlock);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        tryUnlock();
      }
    });

    forgotBtn.addEventListener('click', openForgetModal);
    forgetNo.addEventListener('click', closeForgetModal);
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeForgetModal();
    });
    forgetYes.addEventListener('click', function () {
      clearAllData();
      closeForgetModal();
      teardown();
      try {
        window.location.href = 'index.html';
      } catch (_) {}
    });

    setTimeout(function () { input.focus(); }, 80);
  }

  function boot() {
    if (!needsLock()) return;
    if (document.body) mountGate();
    else document.addEventListener('DOMContentLoaded', mountGate);
  }

  boot();
})();
