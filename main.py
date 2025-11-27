import uuid
import random
import json
import os
from fastapi import FastAPI, Request, Response, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

app = FastAPI()

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# --- ФАЙЛОВАЯ БАЗА ДАННЫХ ---
DB_FILE = "players.json"

def load_db():
    if not os.path.exists(DB_FILE):
        return {}
    try:
        with open(DB_FILE, "r") as f:
            return json.load(f)
    except:
        return {}

def save_db(data):
    with open(DB_FILE, "w") as f:
        json.dump(data, f, indent=4)

# --- УТИЛИТЫ ПОЛЬЗОВАТЕЛЯ ---

def get_or_create_user(request: Request, response: Response = None):
    db = load_db()
    session_id = request.cookies.get("slot_session")
    
    # Если куки нет или пользователя нет в базе
    if not session_id or session_id not in db:
        session_id = str(uuid.uuid4())
        # Стартовый баланс 5000
        db[session_id] = {"balance": 5000} 
        save_db(db)
        if response:
            response.set_cookie(key="slot_session", value=session_id, max_age=31536000) # 1 год
    
    return session_id, db[session_id], db

class SpinRequest(BaseModel):
    bet: int

# --- HTML РОУТИНГ ---

@app.get("/", response_class=HTMLResponse)
async def lobby(request: Request):
    session_id, user, _ = get_or_create_user(request)
    resp = templates.TemplateResponse("lobby.html", {"request": request, "balance": user["balance"]})
    if not request.cookies.get("slot_session"):
        resp.set_cookie("slot_session", session_id)
    return resp

@app.get("/game/classic", response_class=HTMLResponse)
async def game_classic(request: Request):
    session_id, user, _ = get_or_create_user(request)
    return templates.TemplateResponse("index.html", {"request": request, "balance": user["balance"]})

@app.get("/game/grand", response_class=HTMLResponse)
async def game_grand(request: Request):
    session_id, user, _ = get_or_create_user(request)
    return templates.TemplateResponse("grand.html", {"request": request, "balance": user["balance"]})

# --- API ---

@app.get("/api/user/status")
async def get_status(request: Request):
    """Возвращает актуальный баланс (для синхронизации)"""
    _, user, _ = get_or_create_user(request)
    return {"balance": user["balance"]}

@app.post("/api/user/reset")
async def reset_balance(request: Request):
    """Сброс баланса (если проиграл все)"""
    session_id, _, db = get_or_create_user(request)
    db[session_id]["balance"] = 5000
    save_db(db)
    return {"balance": 5000}

# --- ЛОГИКА CLASSIC ---

SYMBOLS_CLASSIC = ["🍒", "🍋", "🍇", "💎", "7️⃣"]
# Веса: вишня выпадает часто, 7-ка редко
WEIGHTS_CLASSIC = [15,   10,   8,    3,    1] 
PAYOUTS_CLASSIC = {"🍒": 3, "🍋": 5, "🍇": 10, "💎": 20, "7️⃣": 100}

@app.post("/api/classic/spin")
async def spin_classic(data: SpinRequest, request: Request):
    session_id, user, db = get_or_create_user(request)
    balance = user["balance"]
    
    if data.bet <= 0:
        raise HTTPException(status_code=400, detail="Ставка должна быть > 0")
    if data.bet > balance:
        raise HTTPException(status_code=400, detail="Недостаточно средств")

    balance -= data.bet
    
    reels = [random.choices(SYMBOLS_CLASSIC, weights=WEIGHTS_CLASSIC)[0] for _ in range(3)]
    
    win = 0
    
    # Победа: 3 одинаковых
    if reels[0] == reels[1] == reels[2]:
        win = data.bet * PAYOUTS_CLASSIC[reels[0]]
    # Утешительный: две семерки
    elif reels.count("7️⃣") == 2:
        win = data.bet * 5

    balance += win
    
    # Сохраняем в файл
    db[session_id]["balance"] = balance
    save_db(db)

    return {
        "reels": reels,
        "balance": balance,
        "win_amount": win
    }

# --- ЛОГИКА GRAND ---

SYMBOLS_GRAND = ["10", "J", "Q", "K", "A", "💎", "7️⃣", "👑"]
WEIGHTS_GRAND = [15, 12, 10, 8,  6,  4,   2,    1]
PAYOUTS_GRAND = {"10": 5, "J": 10, "Q": 15, "K": 20, "A": 30, "💎": 50, "7️⃣": 100, "👑": 500}

@app.post("/api/grand/spin")
async def spin_grand(data: SpinRequest, request: Request):
    session_id, user, db = get_or_create_user(request)
    balance = user["balance"]

    if data.bet <= 0:
        raise HTTPException(status_code=400, detail="Ставка должна быть > 0")
    if data.bet > balance:
        raise HTTPException(status_code=400, detail="Недостаточно средств")

    balance -= data.bet
    
    grid = []
    for _ in range(5):
        grid.append(random.choices(SYMBOLS_GRAND, weights=WEIGHTS_GRAND, k=3))
    
    total_win = 0
    win_lines = []
    
    lines_def = {
        "Center":  [1,1,1,1,1],
        "Top":     [0,0,0,0,0],
        "Bottom":  [2,2,2,2,2],
        "V-Shape": [0,1,2,1,0],
        "A-Shape": [2,1,0,1,2],
    }

    for name, coords in lines_def.items():
        first = grid[0][coords[0]]
        count = 1
        for i in range(1, 5):
            sym = grid[i][coords[i]]
            if sym == first or sym == "👑":
                count += 1
            else:
                break
        
        if count >= 3:
            mult = PAYOUTS_GRAND.get(first, 5)
            # Формула: чем больше совпадений (3,4,5), тем больше множитель
            line_win = int(data.bet * (mult / 10) * (count - 1.5))
            if line_win > 0:
                total_win += line_win
                win_lines.append({"name": name, "count": count})

    balance += total_win
    
    db[session_id]["balance"] = balance
    save_db(db)
    
    sound = "lose"
    if total_win > 0:
        if total_win > data.bet * 20: sound = "jackpot"
        elif total_win > data.bet * 5: sound = "medium"
        else: sound = "small"

    return {
        "grid": grid,
        "balance": balance,
        "win_amount": total_win,
        "win_details": win_lines,
        "sound": sound
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)