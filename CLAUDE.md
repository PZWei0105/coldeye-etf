# 冷眼 ColdEye — 給接手的 Claude

使用者 PZ（痞子葳）沒有程式背景，所有回覆用繁體中文、白話。這個 repo 是他的台股 ETF 資訊 App。

## 原則（不可違反）
- 資料只收官方一手來源（證交所、櫃買、集保、美國財政部、中央社、金管會、央行）。不要加入社群、KOL、論壇內容。
- 證交所「ETF e添富」網站的使用條款禁止程式抓取，不要抓它。
- 觀點必須是固定規則、可重現；任何回測或戰績都要和「一直看多」基準並列。
- 不做自動下單。

## 怎麼操作
- 修改程式後推到 `main` 會觸發 workflow，執行 `control/job.json` 指定的工作；只改介面時把 job 設成 `deploy`。
- 雲端 Claude 工作環境連不到台灣官方網站，資料一律由 GitHub Actions 抓；要實測新端點就把 job 設成 `probe` 並編輯 `control/probe.json`，結果會推到 `probe-results` 分支。
- 執行紀錄在 `state` 分支的 `status.json` 的 `_runs`。
- 本機測試：`python3 tests/local_pipeline.py`、`python3 tests/local_build.py <輸出資料夾>`（需要先有 probe 的原始回應）。
