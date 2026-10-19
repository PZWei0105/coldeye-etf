# 冷眼 ColdEye — 給接手的 Claude

使用者 PZ（痞子葳）沒有程式背景，所有回覆用繁體中文、白話。這個 repo 是他的台股 ETF 資訊 App。

## 原則（不可違反）
- 資料只收官方一手來源（證交所、櫃買、集保、美國財政部、中央社、金管會、央行）。不要加入社群、KOL、論壇內容。
- 證交所「ETF e添富」網站的使用條款禁止程式抓取，不要抓它。
- 觀點與部位建議必須是固定規則、可重現；任何回測或戰績都要和「同類 ETF 一直看多／任何一天」的基準並列（依類別加權，不要用全部 ETF 混在一起的基準）。
- 不做自動下單。
- 使用者的持股、交易、提醒只存在手機的 localStorage，不可送到任何伺服器或寫進 repo。
- 部位建議的門檻（風險屬性、單檔上限、現金分份、減碼幅度、手續費與稅）全部在 `site/pf.js`；改了要同步更新設定頁「加碼、減碼建議怎麼算」的說明（`site/app.js` 的 posRulesHTML）。

## 怎麼操作
- 修改程式後推到 `main` 會觸發 workflow，執行 `control/job.json` 指定的工作；只改介面時把 job 設成 `deploy`。
- 雲端 Claude 工作環境連不到台灣官方網站，資料一律由 GitHub Actions 抓；要實測新端點就把 job 設成 `probe` 並編輯 `control/probe.json`，結果會推到 `probe-results` 分支。
- 執行紀錄在 `state` 分支的 `status.json` 的 `_runs`。
- 本機測試：`python3 tests/local_pipeline.py`、`python3 tests/local_build.py <輸出資料夾>`（需要先有 probe 的原始回應）；部位計算：`node tests/pf_test.mjs [summary.json divs.json track.json]`。
- 介面設計：極夜深藍底、冰川藍＝動作、極光紫＝「你自己」（持有、成本、提醒）、琥珀＝小心；紅漲綠跌只用在價格與損益。數字一律用 Oxanium。
