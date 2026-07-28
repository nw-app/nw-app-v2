# Debug Session: sos-no-ring-community
- **Status**: [OPEN]
- **Issue**: 住戶端按下 SOS 後，社區角色登入的後台頁面沒有響聲（預期應與系統管理員一致會響鈴/跳提醒）。
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: .dbg/trae-debug-log-sos-no-ring-community.ndjson

## Reproduction Steps
1. 用「社區」角色登入後台 `admin.html?c=A117#community/care`，停在「救護 > 住戶SOS」頁面。
2. 用住戶端登入同社區，在前台按下 SOS 按鈕送出通報。
3. 觀察社區後台是否有彈窗/響聲。

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected Signal |
|----|------------|------------|--------|----------------|
| A | 社區後台未收到新 SOS（監聽失敗/被權限擋） | High | Low | 後台 onSnapshot error 或 rawCount 永遠不變 |
| B | 有收到 SOS，但被條件擋住未觸發提醒/響鈴（createdAtMs/狀態/模式判斷） | High | Low | 後台收到 latest，但 `willNotify=false` |
| C | 已觸發提醒流程，但音訊播放被瀏覽器政策擋（需要使用者互動/靜音） | Medium | Low | `willNotify=true` 但音訊播放 rejected/未開始 |
| D | 社區角色走到不同的 UI/權限分支，未執行 SOS 提醒程式碼 | Medium | Low | role/頁面狀態與系統管理員不同，且未呼叫相關函式 |

## Log Evidence
- Pending

## Verification Conclusion
- Pending
