"""用 probe 抓到的官方原始回應測試解析器（不連網）。"""
import json
import pathlib

RAW = pathlib.Path('/tmp/claude-0/-home-claude/2b8d5b7a-3c06-5895-8bd9-d9ac5a2dd931/scratchpad/probe/raw')
RAW2 = pathlib.Path('/tmp/claude-0/-home-claude/2b8d5b7a-3c06-5895-8bd9-d9ac5a2dd931/scratchpad/probe2/raw')
ROUTES2 = [('bulletin/exDailyQ', 'tpex_exright_v1'), ('tpex_exright_prepost', 'tpex_exright_prepost_api'),
           ('daily-treasury-rates', 'ust_yields_2026')]
ROUTES = [
    ('BFI82U', 'twse_bfi82u'), ('MI_INDEX', 'twse_mi_index_etf'), ('T86', 'twse_t86_etf'), ('MI_MARGN', 'twse_margin_etf'),
    ('FMTQIK', 'twse_fmtqik'), ('TWT48U', 'twse_twt48u'), ('TWT49U', 'twse_twt49u'),
    ('announcement/punish', 'twse_punish'), ('announcement/notice', 'twse_notice'),
    ('newsList', 'twse_news'), ('all_etf.txt', 'mis_all_etf'), ('getStockInfo', 'mis_quotes'),
    ('afterTrading/otc', 'tpex_daily_otc'), ('insti/dailyTrade', 'tpex_insti'), ('margin/balance', 'tpex_margin'),
    ('getOD.ashx', 'tdcc_holders'), ('rsscna/finance', 'cna_finance_rss'), ('fsc.gov.tw/RSS', 'fsc_rss'),
    ('cbc.gov.tw/tw/rss', 'cbc_rss'),
]


class R:
    def __init__(self, b):
        self.content = b
        self.status_code = 200


class FakeHttp:
    def __init__(self, *a, **k):
        self.log = []

    def get(self, url, **kw):
        for key, name in ROUTES2:
            if key in url:
                return R((RAW2 / f'{name}.txt').read_bytes())
        for key, name in ROUTES:
            if key in url:
                return R((RAW / f'{name}.txt').read_bytes())
        raise RuntimeError('no fixture for ' + url)

    def json(self, url, **kw):
        return json.loads(self.get(url).content.decode('utf-8-sig'))
