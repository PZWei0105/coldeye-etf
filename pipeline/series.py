"""把原始日資料整理成引擎用的序列：分割與配息還原、指標預先計算、籌碼與淨值依日期對齊。"""
import bisect
import datetime as dt
import math

from . import indicators as ind

FOREIGN_MARKERS = ('美國', '美股', 'NASDAQ', '那斯達克', 'S&P', '標普', '費城', '費半', '日本', '日經',
                   '東證', '印度', '越南', '中國', '上證', '上証', '滬深', '深証', '香港', '恒生', '歐洲',
                   '德國', '全球', '新興', '亞洲', '東協', '韓國', '澳洲', '道瓊', 'FANG', 'NYSE',
                   '美', '海外', '國際', 'Global', 'MSCI', '深100', '中証', '中證', 'A50', '不動產', 'REIT',
                   '世界', '亞太', 'US', '納斯達克')
THEME_MARKERS = ('半導體', '電動車', '5G', '電子', 'ESG', '金融', 'AI', '綠能', '元宇宙', '科技',
                 '低碳', '永續', '電池', '網通', '生技', '醫療', '航運', '電動', '智能', '機器人',
                 '數位', '雲端', '晶圓', '關鍵', '資安', '未來車', '基因', '潔淨', '太空', '衛星', '數據', '電力',
                 'PCB', '工業', '網路', '稀土', '航太', '防衛', 'IC設計')
DIV_MARKERS = ('高股息', '高息', '股息', '股利', '優息', '收益', '配息', '息')
FUT_MARKERS = ('黃金', '原油', '白銀', '黃豆', '玉米', '商品', '期貨', '石油', 'VIX', '美元指數')


def infer_category(code: str, name: str) -> str:
    c = code.upper()
    n = name or ''
    if c.endswith('L') or '正2' in n or '2倍' in n or '槓桿' in n:
        return 'lev'
    if c.endswith('R') or '反1' in n or '反向' in n or '-1' in n:
        return 'inv'
    if c.endswith('U') or any(k in n for k in FUT_MARKERS):
        return 'fut'
    if c.endswith('B') or '債' in n:
        return 'bond'
    if c.endswith('A') or '主動' in n:
        return 'active'
    if any(k in n for k in FOREIGN_MARKERS):
        return 'overseas'
    if any(k in n for k in DIV_MARKERS):
        return 'div'
    if any(k in n for k in THEME_MARKERS):
        return 'theme'
    return 'broad'


CATEGORY_NAMES = {
    'broad': '市值型', 'div': '高股息', 'theme': '產業主題', 'overseas': '海外股票',
    'bond': '債券', 'lev': '槓桿型', 'inv': '反向型', 'fut': '期貨／商品', 'active': '主動式',
}


def is_foreign_exposure(cat: str, name: str) -> bool:
    if cat in ('overseas', 'bond', 'fut'):
        return True
    if cat in ('lev', 'inv', 'active'):
        return any(k in (name or '') for k in FOREIGN_MARKERS)
    return False


def d2i(d: dt.date) -> int:
    return d.year * 10000 + d.month * 100 + d.day


def i2d(n: int) -> dt.date:
    return dt.date(n // 10000, n // 100 % 100, n % 100)


class Series:
    """單一 ETF 的完整時間序列。所有價格欄位為「還原後、以目前價格為基準」的數值。"""

    def __init__(self, code, meta, daily, flows=None, margin=None, nav=None, divs=None,
                 holders=None):
        self.code = code
        self.name = meta.get('name', code)
        self.market = meta.get('market', 'tse')
        self.cat = meta.get('cat') or infer_category(code, self.name)
        self.foreign = is_foreign_exposure(self.cat, self.name)
        rows = sorted(zip(daily['d'], daily['o'], daily['h'], daily['l'], daily['c'],
                          daily['v'], daily.get('val', [None] * len(daily['d']))))
        # 去除沒有收盤價的日子（停牌）
        rows = [r for r in rows if r[4] is not None and r[4] > 0]
        self.dates = [r[0] for r in rows]
        self.raw_o = [r[1] if r[1] else r[4] for r in rows]
        self.raw_h = [r[2] if r[2] else r[4] for r in rows]
        self.raw_l = [r[3] if r[3] else r[4] for r in rows]
        self.raw_c = [r[4] for r in rows]
        self.v = [r[5] or 0.0 for r in rows]
        self.val = [r[6] if r[6] is not None else (r[5] or 0) * r[4] for r in rows]
        self.n = len(rows)
        self.divs = sorted(divs or [])          # [(yyyymmdd, cash)]
        self.splits = []                         # [(yyyymmdd, factor)]
        self._adjust()
        self._index = {d: i for i, d in enumerate(self.dates)}
        self.flow_f = self._align(flows, 0)
        self.flow_t = self._align(flows, 1)
        self.flow_d = self._align(flows, 2)
        self.margin = self._align(margin, 0)
        self.short = self._align(margin, 1)
        self.nav = self._align_scalar(nav)
        self.holders = sorted(holders or [])     # [(yyyymmdd, holders, units)]
        self._indicators()

    # ---------- 還原 ----------
    def _adjust(self):
        n = self.n
        factor = [1.0] * n      # 乘在 i 之前（含 i-1）價格上的累積因子
        div_by_date = {}
        for d, cash in self.divs:
            if cash and cash > 0:
                div_by_date[d] = div_by_date.get(d, 0.0) + cash
        # 由後往前累積
        cum = 1.0
        adj_f = [1.0] * n
        vol_f = [1.0] * n
        cum_v = 1.0
        for i in range(n - 1, 0, -1):
            adj_f[i] = cum
            vol_f[i] = cum_v
            prev_c = self.raw_c[i - 1]
            o = self.raw_o[i]
            d = self.dates[i]
            step = 1.0
            # 分割／反分割：開盤相對前收的跳空超過 ±45%（台股漲跌幅 10%，海外 ETF 也極少見）
            if prev_c and o and (o / prev_c < 1 / 1.45 or o / prev_c > 1.45):
                ratio = prev_c / o
                nice = _nice_ratio(ratio)
                if nice:
                    step *= 1 / nice
                    cum_v *= nice
                    self.splits.append((d, nice))
            if d in div_by_date and prev_c:
                cash = div_by_date[d]
                # 分割當天同時除息的情形極少見，以分割後價格計
                base = prev_c * step
                if base > cash:
                    step *= (base - cash) / base
            cum *= step
        adj_f[0] = cum
        vol_f[0] = cum_v
        self.adj = adj_f
        self.o = [x * f for x, f in zip(self.raw_o, adj_f)]
        self.h = [x * f for x, f in zip(self.raw_h, adj_f)]
        self.l = [x * f for x, f in zip(self.raw_l, adj_f)]
        self.c = [x * f for x, f in zip(self.raw_c, adj_f)]
        self.v_adj = [x * f for x, f in zip(self.v, vol_f)]
        self.splits.reverse()
        del factor

    def _align(self, data, k):
        out = [None] * self.n
        if not data:
            return out
        for i, d in enumerate(self.dates):
            row = data.get(str(d)) if isinstance(data, dict) else None
            if row is None and isinstance(data, dict):
                row = data.get(d)
            if row is not None and k < len(row):
                out[i] = row[k]
        return out

    def _align_scalar(self, data):
        out = [None] * self.n
        if not data:
            return out
        for i, d in enumerate(self.dates):
            v = data.get(str(d), data.get(d)) if isinstance(data, dict) else None
            if v is not None:
                out[i] = v
        return out

    def _indicators(self):
        c = self.c
        self.ma20 = ind.sma(c, 20)
        self.ma60 = ind.sma(c, 60)
        self.ma120 = ind.sma(c, 120)
        self.ma240 = ind.sma(c, 240)
        self.rsi14 = ind.rsi(c, 14)
        _, _, self.macd_hist = ind.macd(c)
        self.atr14 = ind.atr(self.h, self.l, c, 14)
        self.vol20 = ind.vol_daily(c, 20)
        self.vol60 = ind.vol_daily(c, 60)
        self.hi20 = ind.rolling_max(self.h, 20)
        self.lo20 = ind.rolling_min(self.l, 20)
        self.hi60 = ind.rolling_max(self.h, 60)
        self.lo60 = ind.rolling_min(self.l, 60)
        self.hi252 = ind.rolling_max(c, 252)
        self.lo252 = ind.rolling_min(c, 252)
        self.vavg20 = ind.sma(self.v_adj, 20)
        self.valavg20 = ind.sma(self.val, 20)
        # 每天的「近 12 個月配息合計」與配息殖利率（雙指標滑動，一次算完）
        self.ttm = [0.0] * self.n
        divs = [(d, c) for d, c in self.divs if c]
        lo = hi = 0
        acc = 0.0
        for i, d in enumerate(self.dates):
            start = d2i(i2d(d) - dt.timedelta(days=365))
            while hi < len(divs) and divs[hi][0] <= d:
                acc += divs[hi][1]
                hi += 1
            while lo < hi and divs[lo][0] <= start:
                acc -= divs[lo][1]
                lo += 1
            self.ttm[i] = round(acc, 6)
        self.yld = [(t / c * 100) if (t and c) else None for t, c in zip(self.ttm, self.raw_c)]

    # ---------- 查詢 ----------
    def idx(self, d: int):
        return self._index.get(d)

    def idx_on_or_before(self, d: int):
        k = bisect.bisect_right(self.dates, d) - 1
        return k if k >= 0 else None

    def ret(self, i, k):
        if i - k < 0 or self.c[i - k] is None or self.c[i] is None:
            return None
        return self.c[i] / self.c[i - k] - 1

    def fwd(self, i, k=20):
        if i + k >= self.n:
            return None
        return self.c[i + k] / self.c[i] - 1

    def ttm_dividend(self, d: int):
        start = d2i(i2d(d) - dt.timedelta(days=365))
        return sum(cash for dd, cash in self.divs if start < dd <= d and cash)

    def raw_price_factor(self, i):
        """把還原價換回當天的實際成交價格。"""
        return 1 / self.adj[i] if self.adj[i] else 1.0


def _nice_ratio(r):
    """把跳空比例對應到常見的分割比例（例如 4.0 → 1 拆 4）。"""
    cands = [2, 3, 4, 5, 6, 8, 10, 20, 22, 25, 50, 1 / 2, 1 / 3, 1 / 4, 1 / 5, 1 / 10]
    best = min(cands, key=lambda x: abs(math.log(r) - math.log(x)))
    if abs(math.log(r) - math.log(best)) < 0.12:
        return best
    return None
