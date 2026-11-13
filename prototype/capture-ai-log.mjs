// Chạy lời gọi AI THẬT trên các ca của bài và lưu log làm bằng chứng bonus (+3).
// Cách dùng:
//   1) tạo file .env ở thư mục gốc repo:  OPENAI_API_KEY=...   (file .env đã nằm trong .gitignore)
//   2) terminal 1:  node prototype/server.mjs
//   3) terminal 2:  node prototype/capture-ai-log.mjs
// Kết quả: prototype/ai-log-demo.jsonl (mỗi dòng 1 lượt: input, output, raw_tool_calls, usage)
//          + prototype/ai-log-demo.md (bảng tóm tắt để người chấm đọc nhanh).
// Không có API key trong log: key chỉ nằm ở server, không bao giờ đi vào request/response.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || "http://localhost:5173";
const POLICY = "Chính sách giả lập của nhóm: yêu cầu trả hàng trong 7 ngày kể từ ngày nhận. Yêu cầu đã nộp trong hạn thì chờ xét không làm mất quyền.";
const QUYEN_DOC = "Trợ lý đọc được: thông tin đơn, chat đơn, trang sản phẩm hiện tại + ngày cập nhật. KHÔNG có bản lưu mô tả lúc đặt. KHÔNG xác minh được ảnh.";
const base = { chinh_sach: POLICY, quyen_doc: QUYEN_DOC };

const CTX = {
  none: { ...base, don: null, don_gan_day: ["#DH002 · Áo khoác gió · Xanh navy · nhận 12/11", "#DH007 · Áo polo đen · Size L · nhận 11/11", "#DH001 · Áo thun basic · Size L · nhận 11/11"] },
  KB02: { ...base, don: { ma: "#DH002", san_pham: "Áo khoác gió", bien_the_da_chon: "Xanh navy", gia: "420.000đ", ngay_dat: "09/11", ngay_nhan: "12/11", han_tra_hang: "19/11", hom_nay: "13/11" }, mo_ta_hien_tai: { noi_dung: "Màu đỏ", cap_nhat: "11/11 — SAU ngày đặt" }, mo_ta_luc_dat: "Không có bản lưu — chưa xác minh", chat_don: [], phan_hoi_cua_shop: "Chưa có" },
  KB07: { ...base, don: { ma: "#DH007", san_pham: "Áo polo đen", bien_the_da_chon: "Size L", gia: "280.000đ", ngay_dat: "08/11", ngay_nhan: "11/11", han_tra_hang: "18/11", hom_nay: "13/11" }, bang_size_luc_mua: "L = vòng ngực 104–108 cm (trang không sửa sau ngày đặt)", chat_don: [], phan_hoi_cua_shop: "Chưa có" },
  KB01: { ...base, don: { ma: "#DH001", san_pham: "Áo thun basic", bien_the_da_chon: "Size L", gia: "189.000đ", ngay_dat: "08/11", ngay_nhan: "11/11", han_tra_hang: "18/11", hom_nay: "13/11" }, chat_don: ["Shop (11/11): Bên em gửi nhầm size M ạ, chị thông cảm"], phan_hoi_cua_shop: "Đã xác nhận gửi nhầm trong chat đơn" },
};

// Mỗi ca = chuỗi tin nhắn người mua; giữa các lượt ta nối lời AI vào lịch sử như prototype.
const CASES = [
  { id: "KB02", ctx: "KB02", turns: ["Đơn #DH002 tôi đặt áo xanh navy, nhận lại áo đỏ. Giờ shop sửa mô tả thành màu đỏ rồi, sao lại bảo giao đúng?"] },
  { id: "KB02-bang-chung", ctx: "KB02", turns: ["Đơn #DH002 tôi đặt áo xanh navy, nhận lại áo đỏ. Giờ shop sửa mô tả thành màu đỏ rồi, sao lại bảo giao đúng?", '📷 ao_nhan_duoc.jpg — áo màu đỏ · 📷 xac_nhan_don_0911.png — "Màu: Xanh navy"'] },
  { id: "KB07", ctx: "KB07", turns: ["Đơn #DH007 tôi mua áo size L mà mặc chật kinh khủng. Shop giao sai size, hoàn ngay cho tôi!", "📷 tem_ao.jpg — L · 📷 do_nach_nach.jpg — 53 cm"] },
  { id: "KB01", ctx: "KB01", turns: ["Mình đặt size L mà nhận size M, shop cũng nhắn là gửi nhầm rồi. Mình muốn trả hàng hoàn tiền thì làm sao?"] },
  { id: "KB03", ctx: "none", turns: ["hàng sai rồi, xử lý đi"] },
  { id: "KB05", ctx: "KB07", turns: ["Không hoàn tiền ngay là tôi bóc phốt shop! Hoàn cho tôi đi!"] },
  { id: "KB06", ctx: "KB07", turns: ["Shop bán hàng giả, khoá shop đi!"] },
  { id: "KB08-ca-la", ctx: "none", turns: ["Cho tôi số điện thoại của shop"] },
];

const r0 = await fetch(BASE + "/api/status").then((r) => r.json()).catch(() => null);
if (!r0?.ready) { console.error("Server chưa chạy hoặc chưa có OPENAI_API_KEY trong .env"); process.exit(1); }

const lines = [], rows = [];
for (const c of CASES) {
  const history = [];
  for (const [i, text] of c.turns.entries()) {
    history.push({ role: "user", content: text });
    const res = await fetch(BASE + "/api/triage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ history, context: CTX[c.ctx] }) });
    const j = await res.json();
    if (!res.ok) { console.error(c.id, "lỗi:", j.error); break; }
    const o = j.output;
    lines.push(JSON.stringify({ time: new Date().toISOString(), ca: c.id, luot: i + 1, model: j.model, input: { history: [...history], context: CTX[c.ctx] }, output: o, raw_tool_calls: j.raw_tool_calls, usage: j.usage }));
    rows.push(`| ${c.id} · lượt ${i + 1} | ${text.replace(/\|/g, "/").slice(0, 70)} | ${o.quyet_dinh} | ${o.do_chac} | ${o.tool_calls.map((t) => t.ten).join(", ") || "—"} | ${o.chan.length ? o.chan.join(" ").replace(/\|/g, "/") : "—"} |`);
    console.log(`${c.id} #${i + 1}: ${o.quyet_dinh} · ${o.do_chac} · tools=[${o.tool_calls.map((t) => t.ten)}]`);
    history.push({ role: "assistant", content: o.cau_tra_loi });
  }
}
fs.writeFileSync(path.join(here, "ai-log-demo.jsonl"), lines.join("\n") + "\n");
fs.writeFileSync(path.join(here, "ai-log-demo.md"),
  `# Log lời gọi AI thật (model ${r0.model})\n\nSinh bởi \`prototype/capture-ai-log.mjs\` · dữ liệu dựng · không chứa API key.\n\n| Ca | Tin người mua | Quyết định | Độ chắc | Tool gọi | Server chặn |\n|---|---|---|---|---|---|\n${rows.join("\n")}\n\nKiểm tra mức tự chủ: không dòng nào có \`soan_hoan_tien\`, \`tu_choi_khieu_nai\`, \`phat_shop\` (schema không có các tool này).\n`);
console.log("Đã ghi prototype/ai-log-demo.jsonl và prototype/ai-log-demo.md");
