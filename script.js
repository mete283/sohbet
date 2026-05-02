import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getDatabase, ref, set, push, onChildAdded, onChildRemoved, onChildChanged, remove, update, serverTimestamp, onDisconnect, onValue } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-database.js";

// 1. Firebase Yapılandırması
const firebaseConfig = {
    apiKey: "AIzaSyCoLOm-kJrfENI3AHc_FUM9tVwo8Kpkri0",
    authDomain: "sohbet-7c3b5.firebaseapp.com",
    databaseURL: "https://sohbet-7c3b5-default-rtdb.firebaseio.com",
    projectId: "sohbet-7c3b5",
    storageBucket: "sohbet-7c3b5.firebasestorage.app",
    messagingSenderId: "879064512430",
    appId: "1:879064512430:web:78dda057c8fb7a7b98fa3f"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

let myName = "";
let roomCode = "";
window.muteExpiration = 0; 


// 2. Oda Oluşturma
window.createRoom = function() {
    myName = document.getElementById('username').value.trim();
    if (!myName) return alert("Lütfen isminizi girin!");
    roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    startChat();
}

// 3. Odaya Katılma
window.joinRoom = function() {
    myName = document.getElementById('username').value.trim();
    roomCode = document.getElementById('join-code-input').value.trim().toUpperCase();
    if (!myName || !roomCode) return alert("İsim ve Kod gerekli!");
    startChat();
}

// 4. Sohbeti Başlat ve Dinle
function startChat() {
    document.getElementById('setup-container').style.display = 'none';
    document.getElementById('chat-container').style.display = 'block';
    document.getElementById('display-room-code').innerText = "Oda Kodu: " + roomCode;

    const messagesRef = ref(db, `rooms/${roomCode}/messages`);
    const roomRef = ref(db, `rooms/${roomCode}`);
    const myUserRef = ref(db, `rooms/${roomCode}/users/${myName}`);

    onValue(roomRef, (snapshot) => {
        const data = snapshot.val();
        if (data && data.status === "closed") {
            alert("Bu oda yönetici tarafından kapatıldı!");
            window.location.reload();
        }
    });

    onValue(myUserRef, (snapshot) => {
        const userData = snapshot.val();
        if (userData && userData.mutedUntil) {
            window.muteExpiration = userData.mutedUntil;
        }
    });

    onChildAdded(messagesRef, (snapshot) => {
        renderMessage(snapshot.key, snapshot.val());
    });

    onChildRemoved(messagesRef, (snapshot) => {
        const el = document.getElementById(snapshot.key);
        if (el) el.remove();
    });

    onChildChanged(messagesRef, (snapshot) => {
        const el = document.getElementById(snapshot.key);
        const data = snapshot.val();
        if (el && data.type !== "system") {
            const textSpan = el.querySelector('.text-content');
            // Sadece içerik gerçekten editlendiyse (edited flag varsa) yazıyı güncelle
            if (textSpan && data.isEdited) {
                textSpan.innerText = data.text + " (düzenlendi)";
            }
        }
    });

    // Ayrılma Bildirimi (OnDisconnect)
    const exitRef = push(messagesRef);
    onDisconnect(exitRef).set({
        sender: "Sistem",
        text: myName + " ayrıldı",
        type: "system",
        timestamp: serverTimestamp()
    });

    // Katılma Bildirimi
    push(messagesRef, {
        sender: "Sistem",
        text: myName + " katıldı",
        type: "system",
        timestamp: serverTimestamp()
    });
}

// 5. Mesaj Gönder
window.sendMessage = function() {
    if (window.muteExpiration && Date.now() < window.muteExpiration) {
        const kalanSaniye = Math.ceil((window.muteExpiration - Date.now()) / 1000);
        const kalanDakika = Math.ceil(kalanSaniye / 60);
        return alert(`Susturuldunuz! Kalan süre: ${kalanDakika} dk.`);
    }

    const input = document.getElementById('message-input');
    const text = input.value.trim();

    if (text !== "" && roomCode !== "") {
        const messagesRef = ref(db, `rooms/${roomCode}/messages`);
        push(messagesRef, {
            sender: myName,
            text: text,
            isEdited: false, // Yeni özellik
            timestamp: serverTimestamp()
        });
        input.value = "";
        input.focus();
    }
}

function renderMessage(id, data) {
    const chatBox = document.getElementById('chat-box');
    if (!chatBox || document.getElementById(id)) return;

    const msgDiv = document.createElement('div');
    msgDiv.id = id;

    if (data.type === "system") {
        msgDiv.className = "system-msg";
        msgDiv.innerHTML = `<i>${data.text}</i>`;
    } else {
        const isMe = data.sender === myName;
        const time = data.timestamp ? new Date(data.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : "";
        const editedText = data.isEdited ? " (düzenlendi)" : "";

        // RESMİ MAVİ TİK ROZETİ (PNG GÖRSELİ)
        // Buradaki linki kendi yüklediğin bir resimle de değiştirebilirsin.
        const adminBadge = data.isAdmin ? `<img src="https://upload.wikimedia.org/wikipedia/commons/e/e4/Twitter_Verified_Badge.svg" style="width:14px; height:14px; vertical-align:middle; margin-left:3px;" title="Onaylı Yönetici">` : '';

        msgDiv.className = "msg " + (isMe ? "my-msg" : "friend-msg");
        msgDiv.innerHTML = `
            <small>${data.sender}${adminBadge}</small>
            <span class="text-content">${data.text}${editedText}</span>
            <div class="msg-info">
                <span>${time}</span>
            </div>
            ${isMe ? `
                <div class="msg-actions">
                    <button onclick="editMsg('${id}', '${data.text}')" style="background:none; border:none; cursor:pointer;">✏️</button>
                    <button onclick="deleteMsg('${id}')" style="background:none; border:none; cursor:pointer;">🗑️</button>
                </div>
            ` : ""}
        `;
    }

    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

// 7. Diğer Fonksiyonlar
window.deleteMsg = function(id) {
    if(confirm("Silinsin mi?")) {
        remove(ref(db, `rooms/${roomCode}/messages/${id}`));
    }
}

window.editMsg = function(id, oldText) {
    const newText = prompt("Düzenle:", oldText);
    if (newText && newText !== oldText) {
        update(ref(db, `rooms/${roomCode}/messages/${id}`), { 
            text: newText,
            isEdited: true // Düzenlendi işareti ekle
        });
    }
}

window.leaveRoom = function() {
    window.location.reload();
}

window.copyCode = function() {
    navigator.clipboard.writeText(roomCode);
    alert("Kod kopyalandı!");
}

// script.js en altına ekle
window.checkAdminLogin = function() {
    const passInput = document.getElementById('admin-pass-input').value;
    const adminCode = "123456"; // BURAYI KENDİ ŞİFRENLE DEĞİŞTİR

    if (passInput === adminCode) {
        window.location.href = "admin.html"; // Şifre doğruysa panele gönder
    } else {
        alert("Hatalı yönetici kodu!");
    }
}
