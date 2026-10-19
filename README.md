# 冷眼 ColdEye

台灣 ETF 一手資料與規則化觀點 App：<https://pzwei0105.github.io/coldeye-etf/>

- **只收官方一手來源**：臺灣證券交易所、證券櫃檯買賣中心、臺灣集中保管結算所、美國財政部、中央社、金管會、中央銀行。社群與 KOL 不當資訊來源。
- **觀點由固定規則產生**：同樣的資料，每次得出同樣的結論。每個理由都附官方來源。
- **每個觀點都留紀錄**：回測與上線後的實際戰績，都和「一直看多」的基準比較；某一類 ETF 規則沒有優勢時會自動標示並降低信心。
- **GitHub Actions 定時更新、GitHub Pages 發布**，手機加到主畫面即可使用，不需要開電腦、不需要 API 金鑰。

本工具為個人研究用途的資料整理與規則化分析，不是投顧服務，不保證報酬，投資決策請自行判斷。

## 更新時間（台灣時間，交易日）

| 時間 | 內容 |
|---|---|
| 09:00–13:45，每 15 分鐘 | 盤中價格、投信預估淨值與折溢價、加權指數、證交所最新消息、中央社 |
| 14:25 | 收盤行情、重算觀點 |
| 15:40 | 三大法人買賣超 |
| 17:50 | 投信公告淨值 |
| 21:55 | 融資融券 |
| 週六 09:20 | 集保受益人數 |

GitHub 排程忙碌時可能延後數分鐘到數十分鐘。

## 架構

```
.github/workflows/coldeye.yml   排程與發布（資料工作與 Pages 發布分開）
pipeline/                       Python 資料引擎（只用 requests）
  sources.py                    各官方來源的抓取與解析
  build.py                      每輪流程：回補 → 收盤更新 → 計算 → 輸出
  series.py                     分割與配息還原、指標預先計算
  engine.py                     規則引擎（所有門檻都在這裡）
  narrative.py                  固定句型的白話摘要
  backtest.py                   回測、基準比較、類別優勢
  state.py / gitstate.py        資料存在 state 分支（單一 commit，repo 不會變大）
site/                           手機版 App（純 HTML/CSS/JS，PWA）
control/job.json                推到 main 時要執行的工作：probe / backfill / eod / intraday / deploy
tests/                          本機測試（用官方原始回應，不連網）
```

分支：`main` 放程式；`state` 放累積的官方原始資料與計算結果；`probe-results` 是開發時的來源實測紀錄。
