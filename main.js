import { initializeApp } from "https://www.gstatic.com/firebasejs/9.17.1/firebase-app.js";
import { getDatabase, ref, push, set, onValue, onDisconnect, remove, serverTimestamp, get } from "https://www.gstatic.com/firebasejs/9.17.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyB0YwRw9qJ_wruTH4stSpDtMv2nxG61iEQ",
    authDomain: "sosyalweb-a4f40.firebaseapp.com",
    databaseURL: "https://sosyalweb-a4f40-default-rtdb.firebaseio.com",
    projectId: "sosyalweb-a4f40",
    storageBucket: "sosyalweb-a4f40.firebasestorage.app",
    messagingSenderId: "79162691891",
    appId: "1:79162691891:web:efc86fdbdfd2d49cf7ae46",
    measurementId: "G-4G9V8EXLEE"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

let myId = Math.random().toString(36).substring(7);
let currentRoom = null;
let userData = {};
let matchTimeout = null;
let waitingListener = null;
let roomListener = null;

const loginContainer = document.getElementById('login-container');
const chatContainer = document.getElementById('chat-container');
const startBtn = document.getElementById('start-btn');
const nextBtn = document.getElementById('next-btn');
const userCountSpan = document.getElementById('user-count');

// 1. AKTİF KULLANICI TAKİBİ
const presenceRef = ref(db, 'presence/' + myId);
onValue(ref(db, ".info/connected"), (snapshot) => {
    if (snapshot.val() === true) onDisconnect(presenceRef).remove();
});
onValue(ref(db, 'presence'), (snapshot) => {
    userCountSpan.innerText = snapshot.exists() ? Object.keys(snapshot.val()).length : 0;
});

// 2. GİRİŞ
startBtn.onclick = async () => {
    const name = document.getElementById('username').value.trim();
    if (!name) return alert("Lütfen isim girin!");

    const snap = await get(ref(db, 'presence'));
    const isTaken = Object.values(snap.val() || {}).some(u => u.name === name);
    if (isTaken) return alert("Bu isim zaten mevcut!");

    userData = {
        id: myId,
        name: name,
        gender: document.getElementById('gender').value,
        color: document.getElementById('user-color').value,
        age: document.getElementById('age').value || null,
        horoscope: (document.getElementById('horoscope').value || "").toLowerCase()
    };

    set(presenceRef, { name: name });
    loginContainer.classList.add('hidden');
    chatContainer.classList.remove('hidden');
    findMatch(true); 
};

// 3. EŞLEŞME SİSTEMİ (3sn Özellik + Otomatik Eşleşme)
function findMatch(useFilters) {
    if (currentRoom) return;
    clearTimeout(matchTimeout);
    if (waitingListener) waitingListener();

    document.getElementById('messages').innerHTML = "";
    document.getElementById('partner-info').innerText = useFilters ? "Aranıyor (Öncelikli)..." : "Herhangi biri aranıyor...";

    // Bekleme listesine gir
    set(ref(db, 'waiting/' + myId), userData);

    const waitingRef = ref(db, 'waiting');
    waitingListener = onValue(waitingRef, (snapshot) => {
        const list = snapshot.val();
        if (!list || currentRoom) return;

        // Biri beni zaten bir odaya davet etmiş mi kontrol et (Karşılıklı bulma sorunu çözümü)
        for (let partnerId in list) {
            if (partnerId !== myId) {
                const partner = list[partnerId];
                
                // Filtreleme Mantığı
                const isBestMatch = (userData.gender !== "Belirtilmedi" && userData.gender === partner.gender) ||
                                   (userData.age && userData.age === partner.age);

                if (!useFilters || isBestMatch) {
                    const roomId = [myId, partnerId].sort().join('_');
                    setupRoom(roomId, partner);
                    break;
                }
            }
        }
    });

    if (useFilters) {
        matchTimeout = setTimeout(() => findMatch(false), 3000);
    }
}

// 4. ODA KURULUMU VE TAKİBİ
function setupRoom(roomId, partnerData) {
    currentRoom = roomId;
    if (waitingListener) waitingListener();
    
    // Bekleme listesinden her iki tarafı da temizle
    remove(ref(db, 'waiting/' + myId));
    remove(ref(db, 'waiting/' + partnerData.id));

    // Odayı aktif et
    set(ref(db, `rooms/${roomId}/status`), { active: true, users: [myId, partnerData.id] });
    
    startChat(roomId, partnerData);
}

function startChat(roomId, partnerData) {
    document.getElementById('partner-info').innerText = `${partnerData.name} (${partnerData.gender})`;
    const roomMsgRef = ref(db, `rooms/${roomId}/messages`);
    const roomStatusRef = ref(db, `rooms/${roomId}/status`);

    // Mesajları Dinle
    onValue(roomMsgRef, (snapshot) => {
        const msgBox = document.getElementById('messages');
        msgBox.innerHTML = "";
        snapshot.forEach((child) => {
            const m = child.val();
            const div = document.createElement('div');
            div.className = m.user === userData.name ? "msg my-msg" : "msg";
            div.style.backgroundColor = m.color;
            let del = m.user === userData.name ? `<span class="del" onclick="deleteMsg('${roomId}','${child.key}')">x</span>` : "";
            div.innerHTML = `<b>${m.user}:</b> ${m.text} ${del}`;
            msgBox.appendChild(div);
        });
        msgBox.scrollTop = msgBox.scrollHeight;
    });

    // Karşı tarafın çıkışını dinle
    roomListener = onValue(roomStatusRef, (snapshot) => {
        if (!snapshot.exists()) {
            handlePartnerLeft();
        }
    });
}

// KARŞI TARAF GEÇTİĞİNDE
function handlePartnerLeft() {
    if (!currentRoom) return;
    if (roomListener) roomListener(); // Dinleyiciyi durdur
    currentRoom = null;

    const msgBox = document.getElementById('messages');
    const systemMsg = document.createElement('div');
    systemMsg.innerHTML = `<p style="color: #ff4b2b; font-weight: bold; margin: 10px 0;">Karşı taraf geçti. 3 saniye içinde yeni kişi aranıyor...</p>`;
    msgBox.appendChild(systemMsg);
    msgBox.scrollTop = msgBox.scrollHeight;

    let countdown = 3;
    const interval = setInterval(() => {
        countdown--;
        if (countdown <= 0) {
            clearInterval(interval);
            findMatch(true);
        }
    }, 1000);
}

// MESAJ GÖNDERME
function sendMessage() {
    const text = document.getElementById('msg-input').value.trim();
    if (text && currentRoom) {
        push(ref(db, `rooms/${currentRoom}/messages`), { 
            user: userData.name, 
            text: text, 
            color: userData.color, 
            time: serverTimestamp() 
        });
        document.getElementById('msg-input').value = "";
    }
}

window.deleteMsg = (rid, mid) => remove(ref(db, `rooms/${rid}/messages/${mid}`));
document.getElementById('send-btn').onclick = sendMessage;
document.getElementById('msg-input').onkeypress = (e) => { if(e.key === 'Enter') sendMessage(); };

// GEÇ BUTONU
nextBtn.onclick = () => {
    if (currentRoom) {
        remove(ref(db, `rooms/${currentRoom}`)); // Odayı tamamen sil, bu diğer tarafta handlePartnerLeft'i tetikler
        currentRoom = null;
    }
    findMatch(true);
};

document.getElementById('back-to-menu').onclick = () => {
    remove(ref(db, 'waiting/' + myId));
    location.reload();
};
