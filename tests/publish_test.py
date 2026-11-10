"""冷眼後台輸出的小規則（build.py）：

- 新聞去重：證交所偶爾把同一則新聞發兩次（網址不同），同一天、同一個標題只留一則（2026/11/9）。
- v20：最新一天「之前」20 個交易日的平均成交值（資金輪動的熱度＝今天 ÷ 平常；同類排行的成交值）。
- version.json 的 files 有 spark（關注清單的盤中走勢小圖，後台每一輪換新）。

用法：python3 tests/publish_test.py
"""
import json
import pathlib
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from pipeline import build  # noqa: E402

fails = 0


def check(name, cond, info=''):
    global fails
    if not cond:
        fails += 1
    print(('ok   ' if cond else 'FAIL ') + name + (f'  {info}' if info and not cond else ''))


# ---- 新聞去重
T = '新加坡AngelCentral來訪證交所　深化東南亞創新投資交流'
items = [
    {'d': 20261109, 'src': 'twse_news', 't': T, 'url': 'https://a/1'},
    {'d': 20261109, 'src': 'twse_news', 't': T.replace('　', ' ') + ' ', 'url': 'https://a/2'},
    {'d': 20261106, 'src': 'cna', 't': '11月電子期金融期齊跌', 'url': 'https://c/1'},
    {'d': 20261106, 'src': 'cna', 't': '11月電子期金融期齊跌', 'url': 'https://c/1b'},
    {'d': 20261106, 'src': 'twse_news', 't': T, 'url': 'https://a/3'},
    {'d': 20261104, 'src': 'cna', 't': '11月電子期金融期齊跌', 'url': 'https://c/2'},
    {'d': 20261003, 'src': 'twse_news', 't': T, 'url': 'https://a/4'},
    {'d': 20261109, 'src': 'cna', 't': T, 'url': 'https://c/3'},
]
out = [x['url'] for x in build.dedupe_news(items)]
check('官方公告：同一個標題（空白不算）14 天內又發一次只留最新的', 'https://a/1' in out and 'https://a/2' not in out and 'https://a/3' not in out, out)
check('官方公告：超過 14 天的同一個標題照留', 'https://a/4' in out, out)
check('中央社：每天一樣的例行標題是不同天的新聞，照留；同一天重複的拿掉', 'https://c/1' in out and 'https://c/2' in out and 'https://c/1b' not in out, out)
check('不同來源的同一個標題不算重複', 'https://c/3' in out, out)
check('原本的順序不變', out == ['https://a/1', 'https://c/1', 'https://c/2', 'https://a/4', 'https://c/3'], out)
check('沒有標題、日期的不會出錯', build.dedupe_news([{'d': None}, {'d': None}, {}, {'d': 20261109, 't': 'x'}]) == [{'d': None}, {'d': 20261109, 't': 'x'}])

# ---- v20：之前 20 個交易日的平均（不含最新一天）
vals = [float(k) for k in range(30)]
check('之前 20 個的平均（不含自己）', build.avg_before(vals, 29) == sum(range(9, 29)) / 20, build.avg_before(vals, 29))
check('剛好 20 個', build.avg_before([5.0] * 21, 20) == 5.0)
check('不滿 20 個不給', build.avg_before([5.0] * 20, 19) is None)
check('索引超出範圍不給', build.avg_before([5.0] * 20, 25) is None)

# ---- version.json 的時間戳包含 spark.json
check('STAMPS 有 spark 的 at', ('spark', 'at') in build.STAMPS)
with tempfile.TemporaryDirectory() as d:
    D = pathlib.Path(d)
    (D / 'spark.json').write_text(json.dumps({'d': 20261110, 'at': '2026-11-10T10:05:12+08:00', 's': {}}), encoding='utf-8')
    (D / 'live.json').write_text(json.dumps({'at': '2026-11-10T10:05:30+08:00'}), encoding='utf-8')
    (D / 'news.json').write_text('壞掉的檔案', encoding='utf-8')
    st = build.file_stamps(D)
check('file_stamps 讀到 spark 的 at', st.get('spark') == '2026-11-10T10:05:12+08:00', st)
check('讀不到的不列', 'news' not in st and 'summary' not in st, st)

print('全部通過' if not fails else f'{fails} 項失敗')
sys.exit(1 if fails else 0)
