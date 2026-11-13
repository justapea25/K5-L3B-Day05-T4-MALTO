# K5-L3B-Day05-T4-MALTO

Lab Day 5 · **Thiết kế sản phẩm AI cho lúc nó sai** · Track **T4 Thương mại điện tử** · Lớp L3B · Nhóm MALTO

**Lát cắt:** trợ lý trong Trò chuyện với Shopee khi người mua báo *"hàng nhận không đúng mô tả"*. AI chỉ chọn 1 trong 3 việc: hướng dẫn gửi yêu cầu, xin thêm bằng chứng, hoặc chuyển nhân viên. AI **không tự hoàn tiền, không tự đóng khiếu nại, không phạt shop**.

👉 **Bài nộp chính: [`spec.md`](spec.md)**

| Họ và Tên | Mã Học Viên | Việc đã làm |
|---|---|---|
| Nguyễn Xuân Khánh Linh | 2A202603801 | Chặng 1–2: lát cắt, 8 kịch bản rủi ro |
| Đặng Minh Thu | 2A202604009 | Chặng 3: thiết kế khi AI sai (KB02, KB07) |
| Đậu Hoàng Minh | 2A202604011 | Chặng 4–5: mức tự chủ, prototype |

## Cấu trúc

```
spec.md                 bài nộp §1–§7
prototype/
├── index.html          prototype (HTML/CSS/JS một file)
├── server.mjs          server nhỏ cho tab ④ AI thật (bonus)
├── anh1-…-danhso.png   Ảnh #1 có đánh số ①–⑧ (tab Người mua, KB02)
├── anh2-…-danhso.png   Ảnh #2 có đánh số ⑨–⑭ (tab Trưởng nhóm, KB02)
├── anh3-…-danhso.png   Ảnh #3 có đánh số ⑮ (hộp xác nhận chuyển nhân viên, KB02)
├── anh4-bonus-ai-that.png  bằng chứng lời gọi AI thật (KB07)
└── kb02-*, kb07-*      ảnh phụ từng màn hình
```

## Chạy prototype

**Cách 1 — chỉ xem luồng demo (tab ①②③):** mở thẳng `prototype/index.html` bằng trình duyệt. Không cần cài gì.

**Cách 2 — có cả tab ④ AI thật:** cần Node 18+ và một OpenAI API key.

```bash
echo "OPENAI_API_KEY=sk-..." > .env     # file .env đã nằm trong .gitignore
node prototype/server.mjs
# mở http://localhost:5173
```

## Prototype có gì

| Tab | Nội dung |
|---|---|
| ① Người mua | Chat với trợ lý, thẻ đối chiếu (AI biết gì / chưa xác minh gì), độ chắc bằng lời, hạn trả hàng, nhật ký tool có nhãn mức tự chủ |
| ② Người bán | Khiếu nại cần phản hồi trong 48h; không thấy SĐT/địa chỉ người mua |
| ③ Trưởng nhóm | Tóm tắt AI (không phải phán quyết), bằng chứng hai phía; hoàn tiền phải xác nhận, nút từ chối khoá tới khi shop phản hồi hoặc quá 48h, không có nút phạt shop |
| ④ AI thật | Chat nhiều lượt với `gpt-4.1-mini`; model chỉ có 2 tool tự làm, server chặn thêm tool sai sau khi model trả lời |

**Ca demo:** KB02 (shop sửa mô tả sau khi bán) · KB07 (người bán đúng) · KB01 (shop đã nhận lỗi) · KB03 (tin cụt). Bật ô **"Hiện nhãn HAX/PAIR"** để thấy nguyên tắc gắn ở từng chỗ trên màn hình.
