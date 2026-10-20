# 冷眼 ColdEye — 給接手的 Claude

使用者 PZ（痞子葳）沒有程式背景，所有回覆用繁體中文、白話。這個 repo 是他的台股 ETF 資訊 App。

## 原則（不可違反）
- 資料只收官方一手來源（證交所、櫃買、集保、美國財政部、中央社、金管會、央行）。不要加入社群、KOL、論壇內容。
- 證交所「ETF e添富」網站的使用條款禁止程式抓取，不要抓它。
- 觀點與部位建議必須是固定規則、可重現；任何回測或戰績都要和「同類 ETF 一直看多／任何一天」的基準並列（依類別加權，不要用全部 ETF 混在一起的基準）。
- 不做自動下單。
- 使用者的持股、交易、提醒只存在手機的 localStorage，不可送到任何伺服器或寫進 repo。
- 部位建議的門檻（風險屬性、單檔上限、現金分份、減碼幅度、手續費與稅）全部在 `site/pf.js`；改了要同步更新設定頁「加碼、減碼建議怎麼算」的說明（`site/app.js` 的 posRulesHTML）。
- 債券 ETF 證交稅：被動式停徵到 2026/12/31，主動式（代號尾碼 D）照課 0.1%。行政院 2026/10 已把「被動式延長到 2036/12/31、主動式 2027/1/1 起納入」送立法院；三讀通過後改 `pf.js` 的 `BOND_TAX_FREE_UNTIL`、`ACTIVE_BOND_FREE_FROM`，並同步 posRulesHTML、設定頁費用說明、`learn.js` 的 tax 條目。

- 模擬倉（紙上交易）存在 localStorage 的 `coldeye.paper`，真實部位在 `coldeye.pf`；兩本帳用 `core.js` 的 `switchMode` 切換，任何寫入都要經過 `saveBook()`，不可直接寫死 key。

## 怎麼操作
- 修改程式後推到 `main` 會觸發 workflow，執行 `control/job.json` 指定的工作；只改介面時把 job 設成 `deploy`。
- 雲端 Claude 工作環境連不到台灣官方網站，資料一律由 GitHub Actions 抓；要實測新端點就把 job 設成 `probe` 並編輯 `control/probe.json`，結果會推到 `probe-results` 分支。
- 手動執行：`gh workflow run` 在這個環境不能用，改用 REST：`gh api -X POST repos/PZWei0105/coldeye-etf/actions/workflows/coldeye.yml/dispatches -f ref=main -f 'inputs[mode]=backfill'`（mode：auto / intraday / eod / backfill / probe / deploy）。
- 盤中更新是「接力」：每一輪結束前由 `next` 工作等到約 5 分鐘後自己發出下一輪（`pipeline/dispatch.py` 的 `next_tick`），13:36 後或偵測到休市就停；08:37–08:53 的排程只負責暖身，09:00 準時發出第一輪；每 10 分鐘的排程是接力斷掉時的備援。已有排隊中的執行時不會再發，避免把推送或備援擠掉。
- 執行紀錄在 `state` 分支的 `status.json` 的 `_runs`；盤中那幾輪沒有新聞變動時不寫 state（看 Actions 的執行列表）。
- 歷史資料從 2020-01 起（`build.py` 的 `HISTORY_START`），回測包含 2022 年大跌，也包含已下市的 ETF（避免只看活下來的）。每檔的原始收盤、規則訊號取樣、分割與配息輸出在 `out/hist/{代號}.json`，給存股時光機用。
- 本機測試：`python3 tests/local_pipeline.py`、`python3 tests/local_build.py <輸出資料夾>`（需要先有 probe 的原始回應）；部位計算：`node tests/pf_test.mjs [summary.json divs.json track.json]`、`node tests/pf_regress.mjs`；時光機、對決、熱力圖等計算：`node tests/calc_test.mjs [hist/0050.json]`。

## 介面設計（機甲 HUD）
- 極夜深藍底；冰川藍 #4ee0ff＝系統與動作、極光紫 #b59cff＝「你自己」（持有、成本、提醒、模擬倉）、琥珀 #ffb02e＝小心；紅漲 #ff4d6a 綠跌 #17d39a 只用在價格、損益與多空。數字一律用 Oxanium，標題 Noto Serif TC，內文 Noto Sans TC。
- 面板是切角（clip-path，`--cut`）＋角落刻度；鎖定框（`.hud`）只給「冷眼建議」那張卡，琥珀斜紋（`.hazard`）只給要小心的狀態，不要到處用。
- 筆電／電視寬度（≥1100px）是左側停靠列＋三欄戰情室；手機維持單欄。動態只用在開機畫面、大盤之瞳的掃描與價格閃動，並且尊重「減少動態效果」。
- 檔案分工：`calc.js` 純計算（時光機、對決百分位、熱力圖排版、晨報）、`viz.js` 畫圖（瞳孔環、熱力圖、六角雷達、折線）、`learn.js` 名詞解釋（看懂模式）、`tools.js` 對決與時光機畫面。新增名詞時同時補 `learn.js` 的 TERMS，畫面上的元素加 `data-term`。
