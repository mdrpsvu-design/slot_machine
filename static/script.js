const SYMBOLS = ["🍒", "🍋", "🍇", "💎", "7️⃣"];
const SYMBOL_HEIGHT = 120;

const audioSpin = new Audio('/static/sounds/spin.mp3');
const audioStop = new Audio('/static/sounds/stop.mp3');
const audioWin = new Audio('/static/sounds/win_small.mp3');
audioSpin.volume = 0.5;

function randSym() { return SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]; }

function renderSymbol(char) {
    let cssClass = "";
    if(char === "🍒") cssClass = "sym-K"; 
    else if(char === "🍋") cssClass = "sym-Q"; 
    else if(char === "🍇") cssClass = "sym-J"; 
    else if(char === "💎") cssClass = "sym-dia";
    else if(char === "7️⃣") cssClass = "sym-7"; 

    return `<div class="symbol ${cssClass}">${char}</div>`;
}

// --- СИНХРОНИЗАЦИЯ БАЛАНСА ---
async function syncBalance() {
    try {
        const res = await fetch('/api/user/status');
        const data = await res.json();
        const balEl = document.getElementById('balance');
        if(balEl) balEl.innerText = data.balance;
    } catch(e) { console.error("Sync error"); }
}

function initReels() {
    for (let i = 1; i <= 3; i++) {
        const strip = document.getElementById(`strip${i}`);
        if(!strip) continue;
        let html = renderSymbol(randSym()) + renderSymbol("7️⃣") + renderSymbol(randSym());
        strip.innerHTML = html;
        strip.style.transform = `translateY(-${SYMBOL_HEIGHT}px)`;
    }
    syncBalance(); // Синхронизируем при старте
}
document.addEventListener('DOMContentLoaded', initReels);

function changeBet(delta) {
    const inp = document.getElementById('betInput');
    let v = parseInt(inp.value) + delta;
    if(v < 10) v = 10;
    if(v > 2000) v = 2000;
    inp.value = v;
}

async function startSpin() {
    const betInput = document.getElementById('betInput');
    const bet = parseInt(betInput.value);
    const btn = document.getElementById('spinBtn');
    const statusText = document.getElementById('statusText');
    const balanceEl = document.getElementById('balance');
    const winDisplay = document.getElementById('winDisplay');
    const winLine = document.getElementById('winLine');

    let currentBalance = parseInt(balanceEl.innerText);

    if (isNaN(bet) || bet <= 0) {
        statusText.innerText = "Неверная ставка";
        return;
    }
    if (bet > currentBalance) {
        statusText.innerText = "Недостаточно средств!";
        // Предлагаем сброс если совсем пусто
        if (currentBalance < 10) {
            if(confirm("Деньги кончились. Сбросить баланс до 5000?")) {
                await fetch('/api/user/reset', {method:'POST'});
                syncBalance();
            }
        }
        return;
    }

    // UI Lock
    btn.disabled = true;
    if(winLine) winLine.style.display = "none";
    winDisplay.innerText = "0";
    statusText.innerText = "Вращение...";
    statusText.style.color = "#aaa";

    // Визуальное списание (оптимистичное)
    balanceEl.innerText = currentBalance - bet;

    audioSpin.currentTime = 0;
    audioSpin.play().catch(()=>{});

    try {
        const res = await fetch('/api/classic/spin', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ bet: bet })
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Server Error");
        }

        const data = await res.json();
        
        // --- ВАЖНО: Баланс обновляем ТОЛЬКО после ответа сервера ---
        // Но чтобы не было скачка цифр, мы обновим его в конце анимации
        // или сейчас, если доверяем серверу.
        // Для надежности сохраним реальный баланс в переменную
        const serverBalance = data.balance;

        const p1 = spinReel(1, data.reels[0], 1500);
        const p2 = spinReel(2, data.reels[1], 2000);
        const p3 = spinReel(3, data.reels[2], 2500);

        await Promise.all([p1, p2, p3]);

        audioSpin.pause();
        
        // Финальное обновление баланса (синхронизация с сервером)
        balanceEl.innerText = serverBalance;

        if (data.win_amount > 0) {
            statusText.innerText = `🔥 ВЫИГРЫШ: ${data.win_amount} 🔥`;
            statusText.style.color = "#ffd700";
            winDisplay.innerText = data.win_amount;
            if(winLine) winLine.style.display = "block";
            
            const winSound = audioWin.cloneNode();
            winSound.play().catch(()=>{});
        } else {
            statusText.innerText = "Попробуйте снова";
        }

    } catch(e) {
        console.error(e);
        statusText.innerText = "Ошибка: " + e.message;
        statusText.style.color = "red";
        // ОТКАТ БАЛАНСА ПРИ ОШИБКЕ
        balanceEl.innerText = currentBalance; 
        audioSpin.pause();
    } finally {
        btn.disabled = false;
    }
}

function spinReel(id, targetSymbol, duration) {
    return new Promise(resolve => {
        const strip = document.getElementById(`strip${id}`);
        const extraCount = 20 + id * 5; 
        
        let html = "";
        for(let i=0; i<extraCount; i++) html += renderSymbol(randSym());
        html += renderSymbol(targetSymbol);
        html += renderSymbol(randSym());

        strip.innerHTML = html;
        strip.style.transition = "none";
        strip.style.transform = "translateY(0)";
        strip.offsetHeight; 

        const moveY = -(extraCount * SYMBOL_HEIGHT);
        strip.style.transition = `transform ${duration}ms cubic-bezier(0.25, 1, 0.5, 1)`;
        strip.style.transform = `translateY(${moveY}px)`;

        setTimeout(() => {
            const s = audioStop.cloneNode();
            s.volume = 0.3; s.play().catch(()=>{});

            let finalHtml = renderSymbol(randSym()) + renderSymbol(targetSymbol) + renderSymbol(randSym());
            strip.innerHTML = finalHtml;
            strip.style.transition = "none";
            strip.style.transform = `translateY(-${SYMBOL_HEIGHT}px)`;
            resolve();
        }, duration);
    });
}

document.addEventListener('keydown', e => {
    if(e.code === 'Space') {
        e.preventDefault();
        const btn = document.getElementById('spinBtn');
        if(!btn.disabled) btn.click();
    }
});