"""技術指標（純 Python，與資料長度無關的固定算法）。所有函式回傳與輸入等長的 list，資料不足處為 None。"""
import math


def sma(xs, n):
    out = [None] * len(xs)
    s = 0.0
    q = []
    for i, x in enumerate(xs):
        if x is None:
            q.clear()
            s = 0.0
            continue
        q.append(x)
        s += x
        if len(q) > n:
            s -= q.pop(0)
        if len(q) == n:
            out[i] = s / n
    return out


def ema(xs, n):
    out = [None] * len(xs)
    k = 2 / (n + 1)
    e = None
    seed = []
    for i, x in enumerate(xs):
        if x is None:
            continue
        if e is None:
            seed.append(x)
            if len(seed) == n:
                e = sum(seed) / n
                out[i] = e
            continue
        e = x * k + e * (1 - k)
        out[i] = e
    return out


def rsi(closes, n=14):
    """Wilder RSI。"""
    out = [None] * len(closes)
    gain = loss = None
    g_seed, l_seed = [], []
    for i in range(1, len(closes)):
        a, b = closes[i - 1], closes[i]
        if a is None or b is None:
            continue
        ch = b - a
        g, l = max(ch, 0.0), max(-ch, 0.0)
        if gain is None:
            g_seed.append(g)
            l_seed.append(l)
            if len(g_seed) == n:
                gain, loss = sum(g_seed) / n, sum(l_seed) / n
            else:
                continue
        else:
            gain = (gain * (n - 1) + g) / n
            loss = (loss * (n - 1) + l) / n
        out[i] = 100.0 if loss == 0 else 100 - 100 / (1 + gain / loss)
    return out


def macd(closes, fast=12, slow=26, signal=9):
    ef, es = ema(closes, fast), ema(closes, slow)
    line = [None if (a is None or b is None) else a - b for a, b in zip(ef, es)]
    sig = ema(line, signal)
    hist = [None if (a is None or b is None) else a - b for a, b in zip(line, sig)]
    return line, sig, hist


def atr(highs, lows, closes, n=14):
    out = [None] * len(closes)
    trs = []
    a = None
    for i in range(len(closes)):
        h, l, c = highs[i], lows[i], closes[i]
        if h is None or l is None or c is None:
            continue
        pc = closes[i - 1] if i > 0 and closes[i - 1] is not None else c
        tr = max(h - l, abs(h - pc), abs(l - pc))
        if a is None:
            trs.append(tr)
            if len(trs) == n:
                a = sum(trs) / n
                out[i] = a
        else:
            a = (a * (n - 1) + tr) / n
            out[i] = a
    return out


def vol_daily(closes, n=20):
    """近 n 日對數報酬標準差（日）。"""
    out = [None] * len(closes)
    rets = [None]
    for i in range(1, len(closes)):
        a, b = closes[i - 1], closes[i]
        rets.append(math.log(b / a) if a and b and a > 0 and b > 0 else None)
    for i in range(n, len(closes)):
        w = [r for r in rets[i - n + 1:i + 1] if r is not None]
        if len(w) >= n - 2:
            m = sum(w) / len(w)
            out[i] = math.sqrt(sum((r - m) ** 2 for r in w) / (len(w) - 1))
    return out


def rolling_max(xs, n):
    out = [None] * len(xs)
    for i in range(len(xs)):
        w = [x for x in xs[max(0, i - n + 1):i + 1] if x is not None]
        if len(w) >= min(n, i + 1) * 0.8:
            out[i] = max(w)
    return out


def rolling_min(xs, n):
    out = [None] * len(xs)
    for i in range(len(xs)):
        w = [x for x in xs[max(0, i - n + 1):i + 1] if x is not None]
        if len(w) >= min(n, i + 1) * 0.8:
            out[i] = min(w)
    return out


def swing_points(highs, lows, upto, lookback=90, k=3):
    """upto 之前（含）的波段高低點：左右各 k 根都比它低（高）。只用 upto-k 以前確認過的點，避免偷看未來。"""
    hi, lo = [], []
    start = max(k, upto - lookback)
    for i in range(start, upto - k + 1):
        h = highs[i]
        l = lows[i]
        if h is None or l is None:
            continue
        win_h = [x for x in highs[i - k:i + k + 1] if x is not None]
        win_l = [x for x in lows[i - k:i + k + 1] if x is not None]
        if win_h and h >= max(win_h):
            hi.append((i, h))
        if win_l and l <= min(win_l):
            lo.append((i, l))
    return hi, lo
