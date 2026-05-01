import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
// onDisconnect eklendi
import { getDatabase, ref, set, push, onChildAdded, onChildRemoved, onChildChanged, remove, update, serverTimestamp, onDisconnect } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-database.js";

// Firebase Yapılandırması
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

// 1. Oda Oluşturma
window.createRoom = function() {
    myName = document.getElementById('username').value.trim();
    if (!myName) return alert("Lütfen isminizi girin!");
    
    roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    startChat();
}

// 2. Odaya Katılma
window.joinRoom = function() {
    myName = document.getElementById('username').value.trim();
    roomCode = document.getElementById('join-code-input').value.trim().toUpperCase();

    if (!myName || !roomCode) return alert("İsim ve Kod gerekli!");
    startChat();
}

// 3. Sohbeti Başlat ve Dinle
function startChat() {
    document.getElementById('setup-container').style.display = 'none';
    document.getElementById('chat-container').style.display = 'block';
    document.getElementById('display-room-code').innerText = "Kod: " + roomCode;

    const messagesRef = ref(db, 'rooms/' + roomCode + '/messages');

    // --- KATILDI BİLGİSİ GÖNDER ---
    push(messagesRef, {
        sender: "Sistem",
        text: myName + " katıldı",
        type: "system",
        timestamp: serverTimestamp()
    });

    // --- AYRILDI BİLGİSİ (Sekme kapanırsa çalışır) ---
    const disconnectRef = push(messagesRef);
    onDisconnect(disconnectRef).set({
        sender: "Sistem",
        text: myName + " ayrıldı",
        type: "system",
        timestamp: serverTimestamp()
    });

    onChildAdded(messagesRef, (snapshot) => {
        renderMessage(snapshot.key, snapshot.val());
    });

    onChildRemoved(messagesRef, (snapshot) => {
        const msgDiv = document.getElementById(snapshot.key);
        if (msgDiv) msgDiv.remove();
    });

    onChildChanged(messagesRef, (snapshot) => {
        const msgDiv = document.getElementById(snapshot.key);
        if (msgDiv) {
            const data = snapshot.val();
            const textSpan = msgDiv.querySelector('.text-content');
            if (textSpan) textSpan.innerText = data.text + (data.edited ? " (düzenlendi)" : "");
        }
    });
}

// 4. Mesaj Gönder
window.sendMessage = function() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();

    if (text !== "") {
        const messagesRef = ref(db, 'rooms/' + roomCode + '/messages');
        push(messagesRef, {
            sender: myName,
            text: text,
            timestamp: serverTimestamp(),
            edited: false,
            type: "user" // Mesaj tipini belirledik
        });
        input.value = "";
    }
}

// 5. Mesajı Ekrana Yazdır
function renderMessage(id, data) {
    const chatBox = document.getElementById('chat-box');
    const msgDiv = document.createElement('div');
    msgDiv.id = id;

    // Sistem mesajı tasarımı (Katıldı/Ayrıldı)
    if (data.type === "system") {
        msgDiv.className = "system-msg";
        msgDiv.innerText = data.text;
        chatBox.appendChild(msgDiv);
        chatBox.scrollTop = chatBox.scrollHeight;
        return;
    }

    const isMe = data.sender === myName;
    const time = data.timestamp ? new Date(data.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : "";

    msgDiv.className = "msg " + (isMe ? "my-msg" : "friend-msg");
    msgDiv.innerHTML = `
        <small>${data.sender}</small>
        <span class="text-content">${data.text}${data.edited ? " (düzenlendi)" : ""}</span>
        <div class="msg-info">
            <span>${time}</span>
        </div>
        ${isMe ? `
            <div class="msg-actions">
                <button class="action-btn" onclick="editMsg('${id}', '${data.text}')">✏️</button>
                <button class="action-btn" onclick="deleteMsg('${id}')">🗑️</button>
            </div>
        ` : ""}
    `;

    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

// 6. Sohbetten Manuel Çıkış Butonu
window.leaveRoom = function() {
    if(confirm("Sohbetten ayrılmak istediğinize emin misiniz?")) {
        // Not: Burada manuel push yapmıyoruz. 
        // Sayfa yenilendiği anda (location.reload) Firebase bağlantısı kopar
        // ve yukarıdaki startChat içinde kurduğumuz onDisconnect otomatik olarak 
        // tek bir "ayrıldı" mesajı gönderir.
        location.reload(); 
    }
}


// Yardımcı Fonksiyonlar (Aynı kalabilir)
window.deleteMsg = function(id) {
    if(confirm("Bu mesajı silmek istiyor musunuz?")) {
        remove(ref(db, `rooms/${roomCode}/messages/${id}`));
    }
}

window.editMsg = function(id, oldText) {
    const newText = prompt("Mesajı düzenle:", oldText);
    if (newText && newText !== oldText) {
        update(ref(db, `rooms/${roomCode}/messages/${id}`), {
            text: newText,
            edited: true
        });
    }
}

window.copyCode = function() {
    navigator.clipboard.writeText(roomCode);
    alert("Kod kopyalandı: " + roomCode);
}
