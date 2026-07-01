[OPEN] section-no-ring

## Symptoms
- 後台點 `section.account-card` 可出現撥號中 UI，但住戶端沒有推播通知、沒有來電畫面、沒有鈴聲。
- 後台對該住戶的通話紀錄 iframe 與住戶端看到的紀錄內容/未接統計不一致。
- `callrecord.html` 的狀態文字與名稱顯示不符合需求。

## Hypotheses
1. 後台 `section` 點擊路徑有建立本地 UI，但實際沒有成功寫入 `calls` 文件，住戶端因此無法監聽到 `ringing`。
2. `calls` 文件有寫入，但 `fromRole` / `toRole` / `toUid` / `community` 欄位不符合住戶端監聽條件，導致住戶端 listener 忽略該筆來電。
3. `calls` 文件有寫入，住戶端也收到 snapshot，但住戶端來電 modal / 鈴聲流程被較新的狀態或重複判斷提前關閉。
4. 後台與住戶端 `callrecord.html` 對同一批資料使用了不同的篩選/名稱映射/狀態映射規則，造成 2 筆紀錄存在但後台 iframe 顯示為 0 未接或不顯示。
5. `button#btnChatphone`、卡片泡泡、`callrecord.html` 的未接統計不是使用同一組資料條件，所以數值不同步。

## Instrumentation Plan
- 在 `chatphone.html` 補上後台撥號前/寫入後的欄位上報。
- 在 `member.js` 補上住戶端 listener 收到來電文件、忽略條件、顯示 prompt 的上報。
- 在 `callrecord.html` 補上查詢結果數、過濾結果數、狀態統計與名稱映射來源上報。

## Status
- Waiting for instrumentation and reproduction.
