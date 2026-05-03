import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getDatabase, ref, push, onValue, set, onChildAdded, remove, serverTimestamp, onDisconnect, get } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-database.js";

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

let myId = Math.random().toString(36).substring(7);
let myName = "";
let currentRoomId = null;
let isSearching = false;

// HTML elemanlarını seç
const startBtn = document.getElementById('start-btn');
const nameInput = document.getElementById('match-username');
const setupArea = document.getElementById('setup-area');
const waitingArea = document.getElementById('waiting-area');
const matchArea = document.getElementById('match-area');
const chatBox = document.getElementById('chat-box');
const sendBtn = document.getElementById('send-match-btn');
const messageInput = document.getElementById('match-message-input');

// EŞLEŞME ARA BUTONU
startBtn.addEventListener('click', () => {
    myName = nameInput.value.trim();
    if (!myName) return alert("Lütfen bir isim girin!");
    
    setupArea.style.display = 'none';
    waitingArea.style.display = 'block';
    isSearching = true;

    findMatch();
});

async function findMatch() {
    const waitingRef = ref(db, "waiting_users");
    const snapshot = await get(waitingRef);
    const data = snapshot.val();

    let opponentId = null;
    if (data) {
        opponentId = Object.keys(data).find(id => id !== myId);
    }

    if (opponentId) {
        // Birini bulduk
        const roomId = myId < opponentId ? `${myId}_${opponentId}` : `${opponentId}_${myId}`;
        currentRoomId = roomId;
        
        await remove(ref(db, `waiting_users/${opponentId}`));
        startChat(roomId);
    } else {
        // Kimse yok, bekleme listesine gir
        set(ref(db, `waiting_users/${myId}`), { name: myName });
        onDisconnect(ref(db, `waiting_users/${myId}`)).remove();

        // Birisi bizi bulursa diye odayı dinle
        const matchesRef = ref(db, "matches");
        onValue(matchesRef, (snap) => {
            if (currentRoomId) return;
            snap.forEach((child) => {
                if (child.key.includes(myId)) {
                    currentRoomId = child.key;
                    remove(ref(db, `waiting_users/${myId}`));
                    startChat(currentRoomId);
                }
            });
        });
    }
}

function startChat(roomId) {
    waitingArea.style.display = 'none';
    matchArea.style.display = 'flex';
    chatBox.innerHTML = ""; // Temizle

    const messagesRef = ref(db, `matches/${roomId}/messages`);

    // İlk giriş mesajı
    push(messagesRef, {
        type: "system",
        text: "✨ Kullanıcı bulundu, sohbete başlayabilirsin!",
        senderId: "system"
    });

    // Mesajları Dinle
    onChildAdded(messagesRef, (snap) => {
        const data = snap.val();
        if (data.type === "system") {
            addSystemMsg(data.text);
        } else {
            renderMessage(data);
        }
    });

    // Çıkış Bildirimi
    onDisconnect(messagesRef).push({
        type: "system",
        text: `❌ ${myName} sohbetten ayrıldı.`
    });
}

function renderMessage(data) {
    const msgDiv = document.createElement('div');
    const isMe = data.senderId === myId;
    msgDiv.className = `message ${isMe ? 'my-msg' : 'other-msg'}`;
    msgDiv.innerText = data.text;
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function addSystemMsg(text) {
    const div = document.createElement('div');
    div.className = "system-msg";
    div.innerText = text;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

sendBtn.onclick = () => {
    const text = messageInput.value.trim();
    if (text && currentRoomId) {
        push(ref(db, `matches/${currentRoomId}/messages`), {
            senderId: myId,
            text: text,
            timestamp: serverTimestamp()
        });
        messageInput.value = "";
    }
};

window.nextPerson = function() {
    if (currentRoomId) {
        push(ref(db, `matches/${currentRoomId}/messages`), {
            type: "system",
            text: `🔄 ${myName} yeni birine geçti.`
        }).then(() => location.reload());
    } else {
        location.reload();
    }
};
