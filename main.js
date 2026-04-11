import { initializeApp } from "https://www.gstatic.com/firebasejs/9.17.1/firebase-app.js";
import { getDatabase, ref, push, set, onValue, onDisconnect, remove, get, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.17.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyB0YwRw9qJ_wruTH4stSpDtMv2nxG61iEQ",
    authDomain: "sosyalweb-a4f40.firebaseapp.com",
    databaseURL: "https://sosyalweb-a4f40-default-rtdb.firebaseio.com",
    projectId: "sosyalweb-a4f40",
    storageBucket: "sosyalweb-a4f40.firebasestorage.app",
    messagingSenderId: "79162691891",
    appId: "1:79162691891:web:efc86fdbdfd2d49cf7ae46"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

let myId = Math.random().toString(36).substring(7);
let currentRoom = null;
let userData = {};
let isSearching = false;

const userCountSpan = document.getElementById('user-count');
const startBtn = document.getElementById('start-btn');
const messagesBox = document.getElementById('messages');

// --- 1. KESİN VE HIZLI AKTİFLİK SAYACI ---
const myStatusRef = ref(db, 'presence/' + myId);
const connectedRef = ref(db, ".info/connected");

onValue(connectedRef, (snap) => {
    if (snap.val() === true) {
        // Bağlantı koptuğu an (sekme kapanınca) veriyi SİL
        onDisconnect(myStatusRef).remove();
        set(myStatusRef, { online: true, last_changed: serverTimestamp() });
    }
});

// Sayacı her değişimde anında güncelle
onValue(ref(db, 'presence'), (snapshot) => {
    if (snapshot.exists()) {
        const count = Object.keys(snapshot.val()).length;
        userCountSpan.innerText = count;
    } else {
        userCountSpan.innerText = "0";
    }
});

// --- 2. BAŞLAT ---
startBtn.onclick = () => {
    const nameInput = document.getElementById('username').value.trim();
    const ageInput = document.getElementById('user-age').value.trim();
    
    if (!nameInput || !ageInput) return alert("Lütfen isim ve yaş girin!");

    userData = {
        id: myId,
        name: nameInput,
        age: ageInput,
        gender: document.getElementById('gender').value,
        color: document.getElementById('user-color').value
    };

    document.getElementById('login-container').classList.add('hidden');
    document.getElementById('chat-container').classList.remove('hidden');
    findMatch();
};

// --- 3. EŞLEŞME SİSTEMİ ---
async function findMatch() {
    if (isSearching) return;
    isSearching = true;

    if (currentRoom) {
        remove(ref(db, `rooms/${currentRoom}`));
        currentRoom = null;
    }
    messagesBox.innerHTML = '<div class="system-msg">Eşleşme aranıyor...</div>';
    document.getElementById('partner-info').innerText = "Aranıyor...";

    const poolRef = ref(db, 'waiting_pool');
    const snapshot = await get(poolRef);
    const pool = snapshot.val();

    let partner = null;
    if (pool) {
        partner = Object.values(pool).find(u => u.id !== myId);
    }

    if (partner) {
        const roomId = `room_${partner.id}_${myId}`;
        await remove(ref(db, `waiting_pool/${partner.id}`));
        
        const roomData = {
            users: { [myId]: userData, [partner.id]: partner },
            status: "active"
        };

        await set(ref(db, `rooms/${roomId}`), roomData);
        onDisconnect(ref(db, `rooms/${roomId}`)).remove();
        
        isSearching = false;
        startChat(roomId, partner);
    } else {
        await set(ref(db, `waiting_pool/${myId}`), userData);
        onDisconnect(ref(db, `waiting_pool/${myId}`)).remove();

        const roomsRef = ref(db, 'rooms');
        const unsub = onValue(roomsRef, (snap) => {
            const rooms = snap.val();
            for (let rId in rooms) {
                if (rId.includes(myId)) {
                    unsub();
                    remove(ref(db, `waiting_pool/${myId}`));
                    onDisconnect(ref(db, `rooms/${rId}`)).remove();
                    
                    const partnerObj = Object.values(rooms[rId].users).find(u => u.id !== myId);
                    isSearching = false;
                    startChat(rId, partnerObj);
                    break;
                }
            }
        });
    }
}

// --- 4. SOHBET ---
function startChat(roomId, partner) {
    currentRoom = roomId;
    document.getElementById('partner-info').innerText = `${partner.name} (${partner.age}) - ${partner.gender}`;
    messagesBox.innerHTML = '<div class="system-msg">Sohbet başladı!</div>';

    onValue(ref(db, `rooms/${roomId}/messages`), (snapshot) => {
        if (!snapshot.exists()) return;
        messagesBox.innerHTML = "";
        snapshot.forEach((child) => {
            const m = child.val();
            const div = document.createElement('div');
            div.className = m.userId === myId ? "msg my-msg" : "msg";
            if(m.userId === myId) div.style.backgroundColor = userData.color;
            div.innerHTML = `<b>${m.user}:</b> ${m.text}`;
            messagesBox.appendChild(div);
        });
        messagesBox.scrollTop = messagesBox.scrollHeight;
    });

    onValue(ref(db, `rooms/${roomId}`), (snap) => {
        if (!snap.exists() && currentRoom === roomId) {
            document.getElementById('partner-info').innerText = "Ayrıldı.";
            const div = document.createElement('div');
            div.className = "system-msg-error";
            div.innerText = "Partner ayrıldı. Yeni birine geçebilirsiniz.";
            messagesBox.appendChild(div);
            currentRoom = null;
        }
    });
}

function sendMessage() {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (text && currentRoom) {
        push(ref(db, `rooms/${currentRoom}/messages`), {
            userId: myId,
            user: userData.name,
            text: text
        });
        input.value = "";
    }
}

document.getElementById('send-btn').onclick = sendMessage;
document.getElementById('msg-input').onkeypress = (e) => { if(e.key === 'Enter') sendMessage(); };
document.getElementById('next-btn').onclick = () => { isSearching = false; findMatch(); };
document.getElementById('back-to-menu').onclick = () => {
    // Menüye dönerken varlıktan sil
    remove(myStatusRef);
    location.reload();
};
