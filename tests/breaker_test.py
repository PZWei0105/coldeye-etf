"""證交所 MIS 整個掛掉時，一輪不要卡 20 幾分鐘（util.py 的 BREAKER_HOSTS）。

2026/11/2 11:15～11:37 MIS 一直回 502：每個請求重試 3 次、每一批再重試，那一輪跑了 23 分鐘，盤中接力跟著停住。
現在連續 3 次整個失敗就當作這一輪 MIS 掛了，之後的請求直接跳過，下一輪（約 5 分鐘後）再試。

用法：python3 tests/breaker_test.py
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from pipeline import holdings, tape, util  # noqa: E402

fails = 0


def check(name, cond, info=''):
    global fails
    if not cond:
        fails += 1
    print(('ok   ' if cond else 'FAIL ') + name + (f'  {info}' if info and not cond else ''))


util.time.sleep = lambda s: None
tape.time.sleep = lambda s: None


class Resp:
    def __init__(self, code, body=b'{}'):
        self.status_code, self.content = code, body


class FakeSession:
    def __init__(self, plan):
        self.plan, self.calls, self.headers = plan, [], {}

    def get(self, url, **kw):
        self.calls.append(url)
        return self.plan(url)

    post = get


def make(plan):
    h = util.Http(0)
    h.s = FakeSession(plan)
    return h


def raises(fn, kind=RuntimeError):
    try:
        fn()
    except kind as e:
        return e
    return None


# 1. MIS 一直 502：前 3 個請求照常重試，之後直接跳過
util.reset_breaker()
h = make(lambda u: Resp(502))
for _ in range(3):
    e = raises(lambda: h.get('https://mis.twse.com.tw/stock/api/getStockInfo.jsp?x'))
    check('掛掉時照常重試、照常失敗', e is not None and not isinstance(e, util.HostDown), e)
n = len(h.s.calls)
check('前 3 次每次重試 3 回', n == 9, n)
e = raises(lambda: h.get('https://mis.twse.com.tw/stock/api/getStockInfo.jsp?y'), util.HostDown)
check('第 4 次直接跳過（HostDown，不送請求）', e is not None and len(h.s.calls) == n, len(h.s.calls))

# 2. 別的主機不受影響
h2 = make(lambda u: Resp(200))
check('別的主機照常', h2.get('https://www.twse.com.tw/x').status_code == 200)

# 3. 成功一次就歸零
util.reset_breaker()
seq = iter([502, 502, 502, 502, 502, 502, 200, 502, 502, 502, 502, 502, 502, 502, 502, 502])
h3 = make(lambda u: Resp(next(seq)))
raises(lambda: h3.get('https://mis.twse.com.tw/a'))
raises(lambda: h3.get('https://mis.twse.com.tw/a'))
check('中間成功一次', h3.get('https://mis.twse.com.tw/a').status_code == 200)
for _ in range(3):
    e = raises(lambda: h3.get('https://mis.twse.com.tw/a'))
check('歸零之後又要連續 3 次才跳過', e is not None and not isinstance(e, util.HostDown), e)

# 4. 404 不算（只是那一個網址沒有）
util.reset_breaker()
h4 = make(lambda u: Resp(404))
for _ in range(5):
    e = raises(lambda: h4.get('https://mis.twse.com.tw/b'))
check('404 不會讓整個主機被跳過', not isinstance(e, util.HostDown), e)

# 5. 整輪：成分股行情與沙盤五檔在 MIS 掛掉時很快結束
util.reset_breaker()
calls = []


class DownHttp(util.Http):
    def __init__(self, *a, **kw):
        super().__init__(0)
        self.s = FakeSession(lambda u: (calls.append(u), Resp(502))[1])


orig = util.Http
tape.Http = DownHttp
util.Http = DownHttp
holdings_state = {'meta': {}, 'daily': {}}
holdings.domestic_codes = lambda st: {f'{1000 + i}': 'tse' for i in range(320)}
e = raises(lambda: holdings.stock_quotes(holdings_state))
check('成分股行情：MIS 掛掉照樣回報失敗', e is not None, e)
n_sq = len(calls)
check('成分股行情：連續失敗後不再一批一批試', n_sq <= 12, n_sq)

calls.clear()
import pipeline.build as build  # noqa: E402
build.active_codes = lambda st: {f'00{i:03d}' for i in range(250)}
books = tape.fetch_books({'meta': {}})
check('沙盤五檔：MIS 已經確定掛了，一個請求都不送', len(calls) == 0 and not books['reg'], (len(calls), books['errors'][:2]))
check('沙盤五檔：照實記下錯誤', any('HostDown' in x for x in books['errors']), books['errors'][:2])
tape.Http = orig
util.Http = orig

print('全部通過' if not fails else f'{fails} 項失敗')
sys.exit(1 if fails else 0)
