"""共用工具：HTTP（含節流與重試）、數字與民國日期解析、JSON 讀寫。"""
import datetime as dt
import json
import pathlib
import re
import time

import requests

TW = dt.timezone(dt.timedelta(hours=8))
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/129.0 Safari/537.36')


def now_tw() -> dt.datetime:
    return dt.datetime.now(TW)


def today_tw() -> dt.date:
    return now_tw().date()


# 盤中即時行情（證交所 MIS）偶爾整個站掛掉（2026/11/2 11:15～11:37 一直回 502）：每個請求重試 3 次、
# 每一批再重試，一輪會卡 20 幾分鐘，接力跟著停住，網站恢復後也要等這一輪跑完才有新資料。
# 所以同一個程序裡，這些主機「連續 BREAK_AFTER 次整個失敗」（重試完還是失敗，404 不算）就當作這一輪它掛了，
# 之後的請求直接失敗（HostDown），讓這一輪快點結束、5 分鐘後的下一輪再試；任何一次成功就歸零。
BREAKER_HOSTS = {'mis.twse.com.tw'}
BREAK_AFTER = 3
_host_fails = {}


class HostDown(RuntimeError):
    """這一輪已經確定這個主機掛了，不再送請求。"""


def reset_breaker():
    _host_fails.clear()


def _gate(host, url):
    if host in BREAKER_HOSTS and _host_fails.get(host, 0) >= BREAK_AFTER:
        raise HostDown(f'{url} -> skipped ({host} failed {_host_fails[host]} times in a row this round)')


def _note(host, ok, err=None):
    if host not in BREAKER_HOSTS:
        return
    if ok:
        _host_fails[host] = 0
    elif err != 'HTTP 404':
        _host_fails[host] = _host_fails.get(host, 0) + 1


class Http:
    """對同一主機的請求自動間隔，避免被官方網站限流。"""

    def __init__(self, min_gap=2.2):
        self.s = requests.Session()
        self.s.headers.update({'User-Agent': UA, 'Accept': 'application/json, text/plain, */*',
                               'Accept-Language': 'zh-TW,zh;q=0.9'})
        self.min_gap = min_gap
        self._last = {}
        self.log = []

    def _wait(self, host):
        gap = self.min_gap
        last = self._last.get(host)
        if last is not None:
            delta = time.time() - last
            if delta < gap:
                time.sleep(gap - delta)
        self._last[host] = time.time()

    def get(self, url, *, tries=3, timeout=40, verify=True, **kw):
        host = re.sub(r'^https?://([^/]+).*$', r'\1', url)
        _gate(host, url)
        err = None
        for attempt in range(tries):
            self._wait(host)
            try:
                r = self.s.get(url, timeout=timeout, verify=verify, **kw)
                if r.status_code == 200:
                    self.log.append({'url': url, 'status': 200, 'bytes': len(r.content)})
                    _note(host, True)
                    return r
                err = f'HTTP {r.status_code}'
                if r.status_code in (403, 404):
                    break
            except requests.exceptions.SSLError as e:
                err = f'SSL {e!r}'[:300]
                verify = False  # 官方網站偶有中繼憑證未附的情況；僅讀取公開資料
            except Exception as e:  # noqa: BLE001
                err = repr(e)[:300]
            if attempt < tries - 1:
                time.sleep(3 + attempt * 4)
        self.log.append({'url': url, 'error': err})
        _note(host, False, err)
        raise RuntimeError(f'{url} -> {err}')

    def post(self, url, *, data=None, tries=3, timeout=60, verify=True, **kw):
        """送出表單（投信投顧公會的 ASP.NET 查詢頁要用）；和 get 一樣有間隔與重試。"""
        host = re.sub(r'^https?://([^/]+).*$', r'\1', url)
        _gate(host, url)
        err = None
        for attempt in range(tries):
            self._wait(host)
            try:
                r = self.s.post(url, data=data, timeout=timeout, verify=verify, **kw)
                if r.status_code == 200:
                    self.log.append({'url': url, 'status': 200, 'bytes': len(r.content), 'post': True})
                    _note(host, True)
                    return r
                err = f'HTTP {r.status_code}'
                if r.status_code in (403, 404):
                    break
            except requests.exceptions.SSLError as e:
                err = f'SSL {e!r}'[:300]
                verify = False
            except Exception as e:  # noqa: BLE001
                err = repr(e)[:300]
            if attempt < tries - 1:
                time.sleep(3 + attempt * 4)
        self.log.append({'url': url, 'error': err, 'post': True})
        _note(host, False, err)
        raise RuntimeError(f'POST {url} -> {err}')

    def json(self, url, **kw):
        r = self.get(url, **kw)
        txt = r.content.decode('utf-8-sig', errors='replace')
        return json.loads(txt)


_NUM_RE = re.compile(r'[^0-9.\-+eE]')


def num(v):
    """'1,234.5' → 1234.5；'--'、''、'X'、None → None。"""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    s = re.sub(r'<[^>]+>', '', s)  # 證交所漲跌欄位帶 HTML
    if s in ('', '--', '---', '-', 'X', 'x', 'N/A', '除權', '除息', '除權息'):
        return None
    s = s.replace(',', '').replace('%', '').replace(' ', '')
    if s.startswith('X'):
        s = s[1:]
    s = _NUM_RE.sub('', s)
    if s in ('', '+', '-', '.'):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def roc_date(s) -> dt.date | None:
    """'115/10/19'、'115年10月19日'、'1151019'、'20261019'、'2026-10-19' → date。"""
    if s is None:
        return None
    t = str(s).strip()
    t = re.sub(r'<[^>]+>', '', t)
    m = re.match(r'^(\d{2,3})[/年.-](\d{1,2})[/月.-](\d{1,2})', t)
    if m:
        y, mo, d = (int(x) for x in m.groups())
        return dt.date(y + 1911, mo, d)
    m = re.match(r'^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})', t)
    if m:
        y, mo, d = (int(x) for x in m.groups())
        return dt.date(y, mo, d)
    if re.match(r'^\d{8}$', t):
        return dt.date(int(t[:4]), int(t[4:6]), int(t[6:]))
    if re.match(r'^\d{7}$', t):
        return dt.date(int(t[:3]) + 1911, int(t[3:5]), int(t[5:]))
    return None


def read_json(path: pathlib.Path, default=None):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json(path: pathlib.Path, obj, *, compact=True):
    path.parent.mkdir(parents=True, exist_ok=True)
    if compact:
        txt = json.dumps(obj, ensure_ascii=False, separators=(',', ':'))
    else:
        txt = json.dumps(obj, ensure_ascii=False, indent=1)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(txt, encoding='utf-8')
    tmp.replace(path)


def tables_of(payload: dict):
    """證交所 rwd API 有新舊兩種格式：{'fields','data'} 或 {'tables':[{fields,data,title}]}。"""
    out = []
    if not isinstance(payload, dict):
        return out
    if isinstance(payload.get('tables'), list):
        for t in payload['tables']:
            if isinstance(t, dict) and t.get('fields') and t.get('data') is not None:
                out.append({'title': t.get('title', ''), 'fields': t['fields'], 'data': t['data']})
    if payload.get('fields') and payload.get('data') is not None:
        out.append({'title': payload.get('title', ''), 'fields': payload['fields'],
                    'data': payload['data']})
    for k in list(payload.keys()):
        m = re.match(r'^fields(\d+)$', k)
        if m and payload.get('data' + m.group(1)) is not None:
            out.append({'title': payload.get('subtitle' + m.group(1), ''),
                        'fields': payload[k], 'data': payload['data' + m.group(1)]})
    return out


def clean_field(f: str) -> str:
    return re.sub(r'\s+', '', re.sub(r'<[^>]+>', '', str(f)))


def find_col(fields, *cands, start=0):
    """在欄位名稱裡找第一個包含任一候選字的欄位索引。"""
    cf = [clean_field(x) for x in fields]
    for c in cands:
        for i in range(start, len(cf)):
            if c in cf[i]:
                return i
    return None


def sign_from_html(s) -> int:
    t = str(s or '')
    if 'green' in t or '-' in re.sub(r'<[^>]+>', '', t):
        return -1
    if 'red' in t or '+' in re.sub(r'<[^>]+>', '', t):
        return 1
    return 0
