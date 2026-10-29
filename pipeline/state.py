"""持久化資料（存在 repo 的 state 分支）。全部是官方原始數字，計算結果另外輸出。"""
import gzip
import json
import pathlib

FILES = {
    'meta': 'meta.json',            # {代號: {name, market, cat, first, last}}
    'daily': 'daily.json.gz',       # {代號: {d:[yyyymmdd], o:[], h:[], l:[], c:[], v:[], val:[], ch:[]}}
    'flows': 'flows.json.gz',       # {代號: {yyyymmdd: [外資, 投信, 自營商]}}（股）
    'margin': 'margin.json.gz',     # {代號: {yyyymmdd: [融資餘額, 融券餘額]}}（張）
    'nav': 'nav.json.gz',           # {代號: {yyyymmdd: 官方單位淨值}}
    'units': 'units.json.gz',       # {代號: {yyyymmdd: 已發行受益權單位數}}
    'divs': 'divs.json',            # {代號: [[除息日, 每單位現金]]}
    'holders': 'holders.json',      # {代號: [[資料日, 人數, 單位數]]}
    'taiex': 'taiex.json',          # {d:[], c:[], val:[]}
    'mflows': 'mflows.json',        # {yyyymmdd: {f, t, d}} 集中市場三大法人買賣超金額（元）
    'yields': 'yields.json',        # {yyyymmdd: {y10, y20}}
    'views': 'views.json.gz',       # {yyyymmdd: {代號: [stance, score, conf]}}
    'news': 'news.json',            # 最近的公告與新聞
    'status': 'status.json',        # 各來源最後成功／失敗時間
    'backfill': 'backfill.json',    # 歷史回補進度
    'cal': 'cal.json',              # 證交所市場開休市日期（給沙盤）{年: {at, rows:[[日期, 名稱]]}}
    'after': 'after.json',          # 盤後零股成交價／股數、盤後定價成交量（給沙盤）{日期: {代號: [價, 股, 定價股]}}
    'hold': 'holdings.json.gz',     # ETF 成分股（投信投顧公會）{m: {期間: {代號: [[股票代號, 名稱, 種類, %]]}}, q: {...}, zone, checked}
    'global': 'global.json',        # 全球市場（globalmkt.py）{s: {spx/ndx/sox/vix/twd: {d, c}}, q: 最新報價, hist_day, at}
    'stocks': 'stocks.json',        # 成分股的官方個股資料 {d, rev, checked, s: {代號: [名稱, 市場, 產業, 收盤, 漲跌%, 本益比, 殖利率, 淨值比, 月營收年增, 累計年增]}}
}

DEFAULTS = {
    'meta': {}, 'daily': {}, 'flows': {}, 'margin': {}, 'nav': {}, 'units': {}, 'divs': {},
    'holders': {}, 'taiex': {'d': [], 'c': [], 'val': []}, 'mflows': {}, 'yields': {}, 'views': {}, 'news': [],
    'status': {}, 'backfill': {}, 'cal': {}, 'after': {}, 'hold': {}, 'stocks': {}, 'global': {},
}


class State:
    def __init__(self, root: pathlib.Path):
        self.root = root
        self.data = {}
        for k, fn in FILES.items():
            p = root / fn
            obj = None
            if p.exists():
                try:
                    if fn.endswith('.gz'):
                        with gzip.open(p, 'rt', encoding='utf-8') as f:
                            obj = json.load(f)
                    else:
                        obj = json.loads(p.read_text(encoding='utf-8'))
                except (OSError, json.JSONDecodeError):
                    obj = None
            self.data[k] = obj if obj is not None else json.loads(json.dumps(DEFAULTS[k]))

    def __getitem__(self, k):
        return self.data[k]

    def __setitem__(self, k, v):
        self.data[k] = v

    def save(self):
        self.root.mkdir(parents=True, exist_ok=True)
        for k, fn in FILES.items():
            p = self.root / fn
            txt = json.dumps(self.data[k], ensure_ascii=False, separators=(',', ':'))
            if fn.endswith('.gz'):
                with gzip.open(p, 'wt', encoding='utf-8', compresslevel=6) as f:
                    f.write(txt)
            else:
                p.write_text(txt, encoding='utf-8')

    # ---------- 便利函式 ----------
    FIELDS = ('o', 'h', 'l', 'c', 'v', 'val', 'ch')

    def put_daily(self, code, d: int, row: dict, name=None, market=None):
        s = self.data['daily'].setdefault(code, {'d': [], 'o': [], 'h': [], 'l': [], 'c': [], 'v': [], 'val': [], 'ch': []})
        if row.get('c') is None:
            return
        if 'ch' not in s:
            s['ch'] = [None] * len(s['d'])
        src = dict(row)
        src['ch'] = row.get('chg')
        if d in s['d']:
            k = s['d'].index(d)
            for f in self.FIELDS:
                s[f][k] = src.get(f)
        else:
            # 依日期插入（回補時可能不是依序）
            import bisect
            k = bisect.bisect_left(s['d'], d)
            s['d'].insert(k, d)
            for f in self.FIELDS:
                s[f].insert(k, src.get(f))
        m = self.data['meta'].setdefault(code, {})
        if name:
            m['name'] = name
        if market:
            m['market'] = market
        m['first'] = min(m.get('first', d), d)
        m['last'] = max(m.get('last', d), d)

    def put_map(self, key, code, d: int, value):
        self.data[key].setdefault(code, {})[str(d)] = value

    def mark(self, source, ok=True, err=None, when=None):
        st = self.data['status'].setdefault(source, {})
        if ok:
            st['ok_at'] = when
            st.pop('err', None)
        else:
            st['err_at'] = when
            st['err'] = (err or '')[:200]
