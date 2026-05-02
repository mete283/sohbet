import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getDatabase, ref, update, push, onChildAdded, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-database.js";

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

let currentAdminName = "";
let currentRoom = "";

// --- Yönetim Fonksiyonları ---
window.adminMute = function() {
    const room = document.getElementById('target-room').value.trim().toUpperCase();
    const user = document.getElementById('target-user').value.trim();
    const time = document.getElementById('mute-time').value;

    if(!room || !user || !time) return alert("Eksik bilgi!");
    
    const muteUntil = Date.now() + (parseInt(time) * 60000);
    update(ref(db, `rooms/${room}/users/${user}`), { mutedUntil: muteUntil })
    .then(() => alert(`${user} susturuldu.`));
};

window.adminCloseRoom = function() {
    const room = document.getElementById('target-room').value.trim().toUpperCase();
    if(!room) return alert("Oda kodu girin!");
    
    if(confirm("Odayı kapatmak istediğinize emin misiniz?")) {
        update(ref(db, `rooms/${room}`), { status: "closed" })
        .then(() => alert("Oda imha edildi."));
    }
};

// --- Sohbet Katılım Fonksiyonları ---
window.joinAsAdmin = function() {
    currentAdminName = document.getElementById('admin-name').value.trim();
    currentRoom = document.getElementById('target-room').value.trim().toUpperCase();

    if(!currentAdminName || !currentRoom) return alert("Admin adı ve Oda kodu şart!");

    document.getElementById('admin-chat-container').style.display = 'block';
    const messagesRef = ref(db, `rooms/${currentRoom}/messages`);

    // Mesajları Dinle
    onChildAdded(messagesRef, (snapshot) => {
        const data = snapshot.val();
        renderAdminMessage(data);
    });
};

window.sendAdminMessage = function() {
    const input = document.getElementById('admin-message-input');
    const text = input.value.trim();

    if(text !== "") {
        push(ref(db, `rooms/${currentRoom}/messages`), {
            sender: currentAdminName,
            text: text,
            isAdmin: true, // Mavi tik için flag
            timestamp: serverTimestamp()
        });
        input.value = "";
    }
};

function renderAdminMessage(data) {
    const chatBox = document.getElementById('chat-box');
    const msgDiv = document.createElement('div');
    const isSystem = data.type === "system";
    
    msgDiv.style.marginBottom = "8px";
    msgDiv.style.fontSize = "14px";
    
    if(isSystem) {
        msgDiv.innerHTML = `<i style="color:gray;">${data.text}</i>`;
    } else {
        // RESMİ MAVİ TİK ROZETİ
        const badge = data.isAdmin ? `<img src="https://upload.wikimedia.org/wikipedia/commons/e/e4/Twitter_Verified_Badge.svg" style="width:14px; height:14px; vertical-align:middle; margin-left:3px;">` : '';
        msgDiv.innerHTML = `<strong>${data.sender}${badge}:</strong> ${data.text}`;
    }
    
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}