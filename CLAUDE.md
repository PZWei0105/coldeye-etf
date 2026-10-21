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

- 模擬倉（紙上交易）存在 localStorage 的 `coldeye.paper`，真實部位在 `coldeye.pf`；兩本帳用 `core.js` 的 `switchMode` 切換，任何寫入都要經過 `saveBook()`／`replaceBook()`／`setBooks()`，不可直接寫死 key。
- 模擬倉要跟真的下單一樣，不能讓人「挑價格」或「事後反悔」：成交價只能是當下報價（`forms.js` 的 `paperFill`：交易日 09:00–13:25 用夠新的盤中價、13:25–13:30 不成交、13:30–14:30 用收盤價），手續費與稅自動算，成交後不能修改；只有最新一筆、而且價格還沒更新（`qat` 等於目前 live.json 的時間）時可以撤銷。現金用 `pf.js` 的 `lotsCashFlow` 照時間重播算。
- 注意股、處置股（`extra_flags`）是當天的公告，只能套在最新一天；回測與歷史訊號不能用（`engine.analyze` 只在最後一根套用）。
- 已知限制：已下市 ETF 的最後 20 個交易日（算不出 20 日後報酬）與清算價值沒有進入回測。

## 副官（投資小秘書）與決策日記
- 副官是 App 內的固定規則檢查，**不連任何 AI、不替使用者決定買賣**。檢查與巡檢的門檻全部在 `site/aide.js` 的 `AIDE` 常數；改了要同步設定頁「副官怎麼檢查、怎麼對答案」（`aide.js` 的 `aideRulesHTML`，照常數產生）。
- 決策日記存在 localStorage 的 `coldeye.journal`，一律經過 `core.js` 的 `saveJournal()` 寫入；和持股一樣只在手機，不可上傳。還原備份用「合併」（`aide.js` 的 `sanitizeJournal` 逐欄重建、只補回手機沒有的紀錄），不會刪掉或蓋掉現有的。
- 定案與對答案：每筆決定在「記下之後的下一個交易日收盤前」定案（`aide.js` 的 `lockDay`／`lockAt`：`AIDE.lockHM` 13:25 台灣時間；09:00 開盤前記的是當天、其他是下一個星期一到五；平日放假照樣在 13:25 定案；記下時間壞掉時用價格日期的下一個交易日），從定案那天（那天沒開市就是之後第一個有成交的日子）的收盤算到第 20 個交易日（`HORIZON`，該檔自己的成交日，和回測一致）的含息報酬（`trIndex`／`evalEntry`；起點存在 `res.d0/px0`，還沒到期時存在 `e.anchor`）。起點是定案那天的收盤，定案前看到的走勢（記下那天剩下的盤、晚上的國際行情、定案那天的盤中）都已經算進起點，所以定案前改主意不會灌水（用真實歷史量過，只在走勢有利時才留下，命中率只多約 1 個百分點）；換股的換入那檔也從起點那天（或之後第一次成交）的收盤算；結果算出來就存進那筆紀錄（`res`），不再變動。命中率一律和「同類 ETF 任何一天照同樣方向做」並列（`res.bu` 是 `track.json` 的 `by_cat[類別].base_up`；換股用兩檔歷史的 `pairBase`）。理由是長期紀律、調整比重、要用錢的（`NONVIEW_TAGS`）不算命中率。
- 對答案只用「新鮮」的資料：`refreshEvals` 用 `ensureHist(code, { fresh: true })`（和目前 summary 的 asof 同一批、不是離線副本），離線時（`S.offline`）不算；track.json 沒載入不定案。還在交易的冷門 ETF 會一直等到成交滿 20 天，只有確定下市（不在 summary、歷史檔 404）而且超過 `naDays` 才標示無法對答案。
- 一筆紀錄算不算命中率只看 `aide.js` 的 `scoreOf`（畫面上的對了／錯了、本週復盤、語音、打包都用它）：沒有同類基準、冷靜後改變主意沒照做（`coolDropped`）、觀望、`NONVIEW_TAGS` 都不算。貼回的【冷眼結論】與冷靜期回覆，要在定案前（`afterCounts`／`coolDropped`，用時間戳比 `lockAt`）才算數，之後只記錄、不改立場；定案後或對完答案的紀錄不能刪（設定頁只能「整本歸零」，不能挑著刪）。`parseConclusion` 的立場會先拿掉否定（不買、先不加碼）與條件句（跌破…再減碼）。
- 交易自動記日記：只記「今天」的交易（真實部位的今天、模擬倉）。定案前（`desk.js` 的 `decOpen`）還可以修正。交易被刪除或撤銷時（`forms.js` 發出 `lotdel`）：定案前的日記一起拿掉（當成記錯了），定案或對完答案的留著（只是不再連到交易），免得「刪掉再用過去的日期補記」把壞決定藏起來。交易被修改（`lotedit`，`onLotEdit`）：定案前改方向、價格、代號跟著改（換代號就換類別），把日期改成別天就拿掉日記（不是今天的交易）；定案後只更新文字。日記裡的「刪除」也只在定案前出現。重設模擬倉不會刪日記。
- 「帶去問 Claude」只是把文字交給使用者分享或複製（`aide.js` 的 `packEtf`／`packPf`／`packMarket`／`packReview`／`packDuel`／`packWeek`），App 本身不送出任何資料；持股預設只寫比例，使用者打開開關才附金額（副官檢查裡有金額或股數的句子另外存一份比例說法 `tp`，舊紀錄用 `redactAmt` 遮掉）。規則段要求 Claude 只用官方來源、不直接叫人買賣、最後用【冷眼結論】格式總結，`parseConclusion` 依這個格式解析。
- 資產走勢用 `calc.js` 的 `equityCurve`（交易紀錄＋`hist/` 的官方收盤，交易與分割、除息照時間順序重播；比歷史資料還早的交易也算得到之前的配息；冷門 ETF 除權息當天沒成交時，參考價先照除權息調整）重算。

## 定期定額（PZ 用國泰證券）
- 規則照國泰官方說明（https://istockapp.cathaysec.com.tw/Marketing/DCA/）：每月 1～31 號任選、可多選；遇休市順延到下一個交易日；那個月沒有的日期（例如 2/30）那一期不買；盤中、盤後分批買零股，不設價格；每筆金額已含手續費（2026/12/31 前每筆 1 元，以百元為單位、最低 100 元）。國泰改規則時改 `calc.js` 的 `dcaSchedule`／`dcaEstimate` 與 `dca.js` 的說明文字。
- 計畫存在設定的 `plans`（只在手機），格式一律經過 `calc.js` 的 `normPlan`（新增、舊版 `{ day }` 轉換、還原備份都是）：`{ id, c, days, amt, fee, start, end, back, skip, v: 2 }`。
- 自動入帳（`dca.js` 的 `runPlans`，開 App、資料更新、存計畫時執行，排隊不並行）：用 `hist/0050.json` 當官方交易日行事曆（`dcaSchedule`），價格用成交日的官方收盤（`closeOn`），股數＝(金額−手續費)÷收盤價、無條件捨去（`dcaEstimate`），寫進**真實部位**（不論目前顯示哪一本，經過 `core.js` 的 `updateRealBook`）。每筆帶 `dca: { plan, s: 原本扣款日, est: true }`；同一計畫同一期只記一次（計畫刪掉重建時，同一檔同一期也算記過），使用者刪掉的那一期記在 `skip`，不再補。離線或資料還沒到就不記。
- 核對（`openConfirm`）：照國泰成交回報改股數、均價（或成交金額）後 `est: false`；用一般交易表單改過也算核對（`forms.js` 保留 `dca`）。對齊（`openCalibrate`／`dcaCalibrate`）：只照比例調整「預估」那幾筆的股數、每筆花的錢不變，讓這一檔總股數等於國泰庫存；差一成以上會提醒先檢查計畫。
- 定期定額的交易不進決策日記（不是在猜漲跌）。今日行動：扣款日提醒（`dcaDueToday`，週末順延）、待核對筆數（`dcaActions`）。

## 怎麼操作
- 修改程式後推到 `main` 會觸發 workflow，執行 `control/job.json` 指定的工作；只改介面時把 job 設成 `deploy`。
- 雲端 Claude 工作環境連不到台灣官方網站，資料一律由 GitHub Actions 抓；要實測新端點就把 job 設成 `probe` 並編輯 `control/probe.json`，結果會推到 `probe-results` 分支。
- 手動執行：`gh workflow run` 在這個環境不能用，改用 REST：`gh api -X POST repos/PZWei0105/coldeye-etf/actions/workflows/coldeye.yml/dispatches -f ref=main -f 'inputs[mode]=backfill'`（mode：auto / intraday / eod / backfill / probe / deploy）。
- 盤中更新是「接力」：每一輪結束前由 `next` 工作等到約 5 分鐘後自己發出下一輪（`pipeline/dispatch.py` 的 `next_tick`），13:36 後或偵測到休市就停；08:37–08:53 的排程只負責暖身，09:00 準時發出第一輪；每 10 分鐘的排程是接力斷掉時的備援。已有排隊中的執行時不會再發，避免把推送或備援擠掉。
- 執行紀錄在 `state` 分支的 `status.json` 的 `_runs`；盤中那幾輪沒有新聞變動時不寫 state（看 Actions 的執行列表）。
- 歷史資料從 2020-01 起（`build.py` 的 `HISTORY_START`），回測包含 2022 年大跌，也包含已下市的 ETF（避免只看活下來的）。每檔的原始收盤、規則訊號取樣、分割與配息輸出在 `out/hist/{代號}.json`，給存股時光機用。
- 本機測試：`python3 tests/local_pipeline.py`、`python3 tests/local_build.py <輸出資料夾>`（需要先有 probe 的原始回應）；部位計算：`node tests/pf_test.mjs [summary.json divs.json track.json]`、`node tests/pf_regress.mjs`；時光機、對決、熱力圖、資產走勢：`node tests/calc_test.mjs [hist/0050.json]`；副官：`node tests/aide_test.mjs [hist 資料夾] [track.json]`。

## 介面設計（機甲 HUD）
- 極夜深藍底；冰川藍 #4ee0ff＝系統與動作、極光紫 #b59cff＝「你自己」（持有、成本、提醒、模擬倉）、琥珀 #ffb02e＝小心；紅漲 #ff4d6a 綠跌 #17d39a 只用在價格、損益與多空。數字一律用 Oxanium，標題 Noto Serif TC，內文 Noto Sans TC。
- 面板是切角（clip-path，`--cut`）＋角落刻度；鎖定框（`.hud`）只給「冷眼建議」那張卡，琥珀斜紋（`.hazard`）只給要小心的狀態，不要到處用。
- 筆電／電視寬度（≥1100px）是左側停靠列＋三欄戰情室；手機維持單欄。分頁有六個（指揮台、部位、雷達、副官、情報、戰績）。
- 聲光（PZ 要求「聲光效果拉滿」）：動態只放在有意義的時刻——開機點火、大盤之瞳的掃描、價格閃動、切換分頁的掃描、副官檢查逐條鎖定、記錄時蓋章、對答案揭曉；副官核心環會慢慢轉。全部可在設定關（`settings.fx`，body 加 `nofx`），並尊重「減少動態效果」。
- 音效用 WebAudio 即時合成（`fx.js` 的 `SOUNDS`，不放音檔）；手機要先點一下才能出聲，所以開機預設停在「啟動」按鈕（`settings.ignite`）。語音播報用瀏覽器的 speechSynthesis，但只用裝置內建（`localService`）的中文語音——桌機 Chrome 的「Google 國語」、Edge 的 Online 語音會把文字送到網路，而晨報裡有持股，所以這種裝置不念（`voiceStatus`／`voiceWhy` 說明原因）；iPhone 要在點擊當下先 `primeSpeech()`。震動只有 Android 有效。iPhone 側邊靜音時不出聲（`audioSession.type = 'ambient'`）。
- 檔案分工：`calc.js` 純計算（時光機、對決百分位、熱力圖排版、晨報、資產走勢、定期定額排程與預估）、`aide.js` 副官純計算、`dca.js` 定期定額畫面與自動入帳、`viz.js` 畫圖（瞳孔環、熱力圖、六角雷達、折線）、`learn.js` 名詞解釋（看懂模式）、`tools.js` 對決與時光機畫面、`desk.js` 副官畫面、`fx.js` 聲光。新增名詞時同時補 `learn.js` 的 TERMS，畫面上的元素加 `data-term`。新增介面檔案要同時加進 `sw.js` 的 `SHELL_FILES`。
