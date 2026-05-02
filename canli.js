import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getDatabase, ref, push, onChildAdded, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-database.js";

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
const GLOBAL_CODE = "GLOBAL"; 

// --- İSİM ZORUNLULUĞU ---
// Kullanıcı geçerli bir isim girene kadar döngüden çıkamaz
let myName = "";
while (!myName || myName.trim() === "" || myName.toLowerCase() === "anonim") {
    myName = prompt("Lütfen global sohbette görünecek isminizi girin (Zorunludur):");
}

const chatBox = document.getElementById('chat-box');
const messageInput = document.getElementById('global-message-input');
const sendBtn = document.getElementById('send-global-btn');

const globalRef = ref(db, `rooms/${GLOBAL_CODE}/messages`);

// Mesajları Dinle (Her iki tarafta da görünmesini sağlar)
onChildAdded(globalRef, (snapshot) => {
    const data = snapshot.val();
    renderMessage(data);
});

function renderMessage(data) {
    if (!data) return;
    const isMe = data.sender === myName;
    const msgDiv = document.createElement('div');
    
    msgDiv.className = `message ${isMe ? 'my-msg' : 'other-msg'}`;
    
    const badge = data.isAdmin ? `<img src="https://upload.wikimedia.org/wikipedia/commons/e/e4/Twitter_Verified_Badge.svg" class="verified-badge">` : "";
    
    // Zaman damgasını kontrol et ve göster
    const time = data.timestamp ? new Date(data.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : "";

    msgDiv.innerHTML = `
        <span class="msg-sender" style="color: ${isMe ? '#aab8c2' : '#2b457d'}">
            ${data.sender}${badge}
        </span>
        <span class="msg-text">${data.text}</span>
        <span style="font-size: 9px; opacity: 0.6; display: block; text-align: right;">${time}</span>
    `;
    
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

// Mesaj Gönderimi
sendBtn.onclick = () => {
    const text = messageInput.value.trim();
    if (text) {
        push(globalRef, {
            sender: myName,
            text: text,
            timestamp: serverTimestamp()
        });
        messageInput.value = "";
    }
};

// Enter tuşu desteği
messageInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendBtn.click();
});
