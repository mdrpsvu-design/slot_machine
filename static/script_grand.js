const SYMBOLS = ["10", "J", "Q", "K", "A", "💎", "7️⃣", "👑"];
const SYMBOL_HEIGHT = 120; 

const sounds = {
    spin: new Audio('/static/sounds/spin.mp3'),
    stop: new Audio('/static/sounds/stop.mp3'),
    small: new Audio('/static/sounds/win_small.mp3'),
    medium: new Audio('/static/sounds/win_medium.mp3'),
    jackpot: new Audio('/static/sounds/jackpot.mp3')
};
Object.values(sounds).forEach(s => s.volume = 0.4);
sounds.spin.loop = true;

function randSym() { return SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]; }

async function syncBalance() {
    try {
        const res = await fetch('/api/user/status');
        const data = await res.json();
        document.getElementById('balance').innerText = data.balance;
    } catch(e) {}
}

function renderSymbol(char) {
    let cssClass = "";
    if (char === "10") cssClass = "sym-10";
    else if (char === "J") cssClass = "sym-J";
    else if (char === "Q") cssClass = "sym-Q";
    else if (char === "K") cssClass = "sym-K";
    else if (char === "A") cssClass = "sym-A";
    else if (char === "7️⃣") cssClass = "sym-7";
    else if (char === "💎") cssClass = "sym-dia";
    else if (char === "👑") cssClass = "sym-wild";
    return `<div class="symbol ${cssClass}">${char}</div>`;
}

// Заполнение при старте (добавляем фейковые символы сверху/снизу)
function init() {
    for(let i=0; i<5; i++) {
        const strip = document.getElementById(`col${i}`);
        // [Скрытый верх] [1] [2] [3] [Скрытый низ]
        let html = renderSymbol(randSym()); // Верхний буфер
        for(let j=0; j<3; j++) html += renderSymbol(randSym());
        html += renderSymbol(randSym()); // Нижний буфер
        
        strip.innerHTML = html;
        // Смещаем на -120px, чтобы скрыть верхний буфер и показать 3 реальных
        strip.style.transform = `translateY(-${SYMBOL_HEIGHT}px)`;
    }
    syncBalance();
}
init();

function changeBet(delta) {
    const inp = document.getElementById('betInput');
    let v = parseInt(inp.value) + delta;
    if(v < 50) v = 50;
    if(v > 5000) v = 5000;
    inp.value = v;
}

// --- ИГРОВОЙ ПРОЦЕСС ---
async function play() {
    const betInput = document.getElementById('betInput');
    const btn = document.getElementById('spinBtn');
    const msg = document.getElementById('msg');
    const balanceEl = document.getElementById('balance');
    const winEl = document.getElementById('winDisplay');
    const svg = document.getElementById('linesSvg');

    // 1. Получаем значения
    const bet = parseInt(betInput.value);
    let currentBalance = parseInt(balanceEl.innerText);

    // 2. ПРОВЕРКА БАЛАНСА (До запроса)
    if (bet > currentBalance) {
        msg.innerText = "Недостаточно средств!";
        msg.style.color = "red";
        
        // Доп. фишка: Предложить сброс, если денег совсем мало
        if (currentBalance < 50) {
             if(confirm("Баланс пуст. Получить бесплатные 5000 монет?")) {
                 try {
                     await fetch('/api/user/reset', {method: 'POST'});
                     const res = await fetch('/api/user/status');
                     const data = await res.json();
                     balanceEl.innerText = data.balance;
                     msg.innerText = "Баланс пополнен!";
                     msg.style.color = "white";
                 } catch(e) { console.error(e); }
             }
        }
        return; // Прерываем функцию, запрос не отправляем
    }

    // Сброс интерфейса перед спином
    svg.innerHTML = "";
    winEl.innerText = "0";
    winEl.classList.remove('win');
    msg.innerText = "Вращение...";
    msg.style.color = "#aaa"; // Сброс цвета
    btn.disabled = true;

    document.querySelectorAll('.symbol').forEach(el => el.classList.remove('win-blink'));

    // 3. ОПТИМИСТИЧНОЕ СПИСАНИЕ (Визуально отнимаем сразу)
    balanceEl.innerText = currentBalance - bet;

    sounds.spin.currentTime = 0;
    sounds.spin.play().catch(()=>{});

    try {
        // 4. ЗАПРОС НА СЕРВЕР
        const res = await fetch('/api/grand/spin', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({bet})
        });
        
        if(!res.ok) {
            // Если сервер вернул ошибку (400, 500), читаем текст ошибки
            const errData = await res.json();
            throw new Error(errData.detail || "Ошибка сервера");
        }
        
        const data = await res.json();
        
        // Важно: на этом этапе баланс уже списан визуально. 
        // Мы обновим его на точное значение от сервера после анимации.

        const spins = [];
        // Запуск анимации 5 колонок
        for(let i=0; i<5; i++) {
            spins.push(spinColumn(i, data.grid[i], 1200 + i*300));
        }
        
        await Promise.all(spins);
        
        // --- ВСЕ ОСТАНОВИЛОСЬ ---
        sounds.spin.pause();
        
        // 5. ОБНОВЛЕНИЕ БАЛАНСА (Синхронизация с сервером)
        balanceEl.innerText = data.balance;
        
        if(data.win_amount > 0) {
            winEl.innerText = data.win_amount;
            winEl.classList.add('win');
            msg.innerText = getWinMessage(data.sound);
            msg.style.color = "#ffd700"; // Золотой цвет текста
            
            if(sounds[data.sound]) {
                sounds[data.sound].currentTime = 0;
                sounds[data.sound].play().catch(()=>{});
            }

            drawWinLines(data.win_details);
        } else {
            msg.innerText = "Попробуйте еще раз";
        }

    } catch(e) {
        // --- БЛОК CATCH (ВОЗВРАТ БАЛАНСА) ---
        console.error(e);
        msg.innerText = "Ошибка: " + e.message;
        msg.style.color = "red";
        
        // Возвращаем деньги визуально, так как спин не состоялся
        balanceEl.innerText = currentBalance; 
        
        sounds.spin.pause();
    } finally {
        // Разблокируем кнопку в любом случае
        btn.disabled = false;
    }
}

function spinColumn(colIndex, targetSymbols, duration) {
    return new Promise(resolve => {
        const strip = document.getElementById(`col${colIndex}`);
        const extraCount = 20 + colIndex * 4; 
        
        let html = "";
        
        // 1. Генерируем ленту
        // Добавляем буфер сверху (тот, что сейчас видим)
        // Чтобы не было скачка, можно взять текущий innerHTML, но для простоты перегенерируем:
        // Начало ленты должно совпадать с тем, что сейчас на экране, но мы делаем blur, так что не критично.
        
        for(let i=0; i<extraCount; i++) {
            html += renderSymbol(randSym());
        }
        
        // 2. Добавляем ЦЕЛЕВЫЕ символы
        targetSymbols.forEach(s => html += renderSymbol(s));
        
        // 3. Добавляем НИЖНИЙ буфер (чтобы лента не обрывалась резко)
        html += renderSymbol(randSym()); 

        strip.innerHTML = html;
        
        // Сбрасываем позицию (начинаем крутить с верха ленты)
        // Позиция 0 означает, что мы видим первый символ "мусора"
        strip.style.transition = "none";
        strip.style.transform = `translateY(0px)`;
        
        strip.offsetHeight; // Reflow
        
        // 4. Вычисляем куда ехать.
        // Нам нужно остановиться так, чтобы targetSymbols были в окне.
        // Окно высотой 360px (3 символа).
        // Структура ленты: [Trash (extraCount)] [Target1] [Target2] [Target3] [Buffer]
        // Мы хотим, чтобы верх окна был на уровне Target1.
        // Значит, нужно сдвинуть вверх на высоту (extraCount * SYMBOL_HEIGHT).
        
        const moveY = -(extraCount * SYMBOL_HEIGHT);
        
        strip.style.transition = `transform ${duration}ms cubic-bezier(0.2, 0.8, 0.4, 1.05)`;
        strip.style.transform = `translateY(${moveY}px)`;
        
        setTimeout(() => {
            const s = sounds.stop.cloneNode();
            s.volume = 0.3; s.play().catch(()=>{});
            
            // 5. ПОДМЕНА ДЛЯ БЕСКОНЕЧНОСТИ
            // Сейчас лента стоит на Target1. Снизу виден кусок Buffer.
            // Мы заменяем весь HTML на компактную версию:
            // [RandomBuffer] [Target1] [Target2] [Target3] [RandomBuffer]
            // И ставим offset на -120px (чтобы видеть Targets).
            // Визуально ничего не изменится, но DOM очистится и края будут "закрыты".
            
            let finalHtml = renderSymbol(randSym()); // Верхний скрытый
            targetSymbols.forEach(s => finalHtml += renderSymbol(s)); // Видимые
            finalHtml += renderSymbol(randSym()); // Нижний скрытый (тот самый, что создает иллюзию продолжения)
            
            strip.innerHTML = finalHtml;
            strip.style.transition = "none";
            strip.style.transform = `translateY(-${SYMBOL_HEIGHT}px)`;
            
            resolve();
        }, duration);
    });
}

function drawWinLines(lines) {
    const svg = document.getElementById('linesSvg');
    const slotArea = document.querySelector('.slots-area');
    // Получаем координаты самой области слотов для расчета относительных позиций
    const areaRect = slotArea.getBoundingClientRect();

    const lineDefs = {
        "Center":  [1,1,1,1,1],
        "Top":     [0,0,0,0,0],
        "Bottom":  [2,2,2,2,2],
        "V-Shape": [0,1,2,1,0],
        "A-Shape": [2,1,0,1,2]
    };
    
    const colors = ["#ff0000", "#00ff00", "#0088ff", "#ffff00", "#ff00ff"];

    lines.forEach((line, idx) => {
        const rowIndexes = lineDefs[line.name];
        if(!rowIndexes) return;

        let points = "";
        const color = colors[idx % colors.length];

        for(let col=0; col<5; col++) {
            const row = rowIndexes[col];
            
            // 1. Находим DOM элемент колонки
            const colEl = document.getElementById(`col${col}`).parentElement; // .col-window
            const colRect = colEl.getBoundingClientRect();
            
            // 2. Вычисляем X: Центр колонки относительно SVG контейнера
            const centerX = (colRect.left - areaRect.left) + (colRect.width / 2);
            
            // 3. Вычисляем Y: Центр ряда (0, 1 или 2)
            // У нас 3 ряда по 120px. Центр 0-го = 60, 1-го = 180, 2-го = 300.
            const centerY = (row * SYMBOL_HEIGHT) + (SYMBOL_HEIGHT / 2);
            
            points += `${centerX},${centerY} `;

            // Подсветка
            const strip = document.getElementById(`col${col}`);
            // В strip у нас сейчас 5 детей: [Hidden] [T1] [T2] [T3] [Hidden]
            // Значит T1 (row 0) это index 1.
            const visibleRowIndex = row + 1; 
            
            if(strip.children[visibleRowIndex]) {
                const cell = strip.children[visibleRowIndex];
                cell.classList.add('win-blink');
                cell.style.borderColor = color;
            }
        }

        const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
        polyline.setAttribute("points", points);
        polyline.setAttribute("class", "payline");
        polyline.setAttribute("stroke", color);
        // Слегка смещаем, если линий много, чтобы не перекрывали друг друга
        if(idx > 0) {
             polyline.setAttribute("transform", `translate(0, ${idx * 4 - 8})`);
        }
        svg.appendChild(polyline);
    });
}

function getWinMessage(type) {
    if(type === 'jackpot') return "💰 JACKPOT 💰";
    if(type === 'medium') return "BIG WIN!";
    return "WIN!";
}

document.addEventListener('keydown', e => {
    if(e.code === 'Space') {
        e.preventDefault();
        const btn = document.getElementById('spinBtn');
        if(!btn.disabled) btn.click();
    }
});