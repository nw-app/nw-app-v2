# Debug Session: section-call-no-ring
- **Status**: [OPEN]
- **Issue**: `chatphone.html` 中點 `img` 可正常撥號並讓住戶端響鈴，但點整張 `section.account-card` 時，住戶端沒有來電畫面也沒有響鈴。
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: .dbg/trae-debug-log-section-call-no-ring.ndjson

## Reproduction Steps
1. 開啟 `chatphone.html`。
2. 先點卡片內 `img`，確認住戶端會出現來電畫面並響鈴。
3. 再點同一張卡片的其他區域或整張 `section.account-card`。
4. 觀察住戶端是否有來電畫面、是否有響鈴、`calls` 文件內容是否一致。

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | `section` 點擊沒有走到和 `img` 相同的撥號函式 | High | Low | Pending |
| B | `section` 路徑傳入的 `uid/target` 不完整，造成寫入 `calls` 文件資料異常 | High | Low | Pending |
| C | `section` 路徑建立的 `calls` 文件欄位和 `img` 路徑不同，受話端監聽條件對不到 | Med | Low | Pending |
| D | `section` 路徑觸發後又被重複事件或清理邏輯立即中止 | Med | Med | Pending |

## Log Evidence
- Debug collector started on `127.0.0.1:7777`
- Instrumentation added in `chatphone.html` for pointer/click path and call document write path

## Verification Conclusion
- Pending
