// Server nhỏ cho prototype T4: phục vụ index.html và gọi OpenAI thật cho quyết định chính.
// Chạy:  node prototype/server.mjs   rồi mở http://localhost:5173
// Key đọc từ ../.env (OPENAI_API_KEY) — KHÔNG gửi xuống trình duyệt, KHÔNG ghi vào log.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function loadEnv(file) {
  try {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  } catch { /* không có .env thì thôi */ }
}
loadEnv(path.join(here, "..", ".env"));

const KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const PORT = Number(process.env.PORT || 5173);
const LOG = path.join(here, "ai-log.jsonl");

// Chỉ những tool AI được TỰ LÀM theo §4 mới nằm trong enum.
// soan_hoan_tien / tu_choi_khieu_nai (trưởng nhóm duyệt) và phat_shop (cấm) không có ở đây,
// nên model không thể đề xuất gọi chúng — mức tự chủ được ép bằng schema, không chỉ bằng prompt.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["quyet_dinh", "do_chac", "ly_do", "con_thieu", "tool_ai_tu_lam", "cau_tra_loi"],
  properties: {
    quyet_dinh: { type: "string", enum: ["huong_dan_gui_yeu_cau", "xin_them_bang_chung", "chuyen_nhan_vien"] },
    do_chac: { type: "string", enum: ["thieu_thong_tin", "chua_du_can_cu", "du_can_cu_de_chuyen_duyet"] },
    ly_do: { type: "array", items: { type: "string" } },
    con_thieu: { type: "array", items: { type: "string" } },
    tool_ai_tu_lam: { type: "array", items: { type: "string", enum: ["yeu_cau_bang_chung", "chuyen_truong_nhom"] } },
    cau_tra_loi: { type: "string" },
  },
};

const SYSTEM = `Bạn là trợ lý AI trong mục "Trò chuyện với sàn" của một sàn thương mại điện tử (dữ liệu dựng cho bài học).
Người mua đang báo "hàng nhận không đúng mô tả". Bạn chỉ được chọn MỘT trong ba quyết định:
- huong_dan_gui_yeu_cau: căn cứ đã rõ (ví dụ shop đã tự xác nhận lỗi trong chat đơn) → hướng dẫn người mua tạo yêu cầu trả hàng; nhân viên vẫn duyệt.
- xin_them_bang_chung: thiếu thông tin hoặc bằng chứng → nói CỤ THỂ còn thiếu gì.
- chuyen_nhan_vien: hai bên mâu thuẫn, chưa đủ căn cứ cho phía nào, hoặc yêu cầu vượt thẩm quyền.

Chọn do_chac theo đúng định nghĩa:
- thieu_thong_tin: CHƯA biết đơn nào, hoặc CHƯA biết hàng khác mô tả ở chỗ nào. (Đã có đơn trong NGỮ CẢNH và tin nhắn đã nói chỗ sai thì KHÔNG dùng mức này.)
- chua_du_can_cu: đã biết đơn và chỗ sai, nhưng bằng chứng chưa đủ, chưa xác minh được, hoặc hai bên mâu thuẫn. Còn thiếu ẢNH hay SỐ ĐO thì vẫn là mức này, không phải thieu_thong_tin.
  Ví dụ: NGỮ CẢNH có đơn #DH007, khách nói "áo L mặc chật", chưa có ảnh → chua_du_can_cu.
- du_can_cu_de_chuyen_duyet: hệ thống có xác nhận (ví dụ shop tự nhận lỗi trong chat đơn, hoặc shop đồng ý trả hàng) và bằng chứng người mua khớp.

Chọn quyet_dinh:
- Thiếu đơn / thiếu chỗ sai → xin_them_bang_chung, hỏi đúng MỘT câu.
- Đã biết chỗ sai nhưng còn thiếu bằng chứng cụ thể mà người mua tự gửi được → xin_them_bang_chung.
- Bằng chứng người mua đã đủ nhưng vẫn chưa kết luận được (mô tả bị sửa sau ngày đặt, số đo khớp bảng size nhưng khách vẫn khiếu nại, hai bên mâu thuẫn) → chuyen_nhan_vien.
- Yêu cầu vượt thẩm quyền (nghi hàng giả, đòi khoá/phạt shop) → chuyen_nhan_vien, nói rõ bạn không hứa kết quả.
- Shop đã tự xác nhận lỗi → huong_dan_gui_yeu_cau.
- Xin số điện thoại/địa chỉ → từ chối trong cau_tra_loi, quyết định theo tình trạng khiếu nại.
LICH_SU_CHAT cho biết người mua đã gửi gì; ảnh được mô tả bằng chữ (ví dụ "📷 tem_ao.jpg — L"), coi như người mua đã gửi.

Luật bắt buộc:
1. Bạn KHÔNG tự hoàn tiền, KHÔNG từ chối/đóng khiếu nại, KHÔNG phạt hay khoá shop, và không hứa những việc đó hay hứa thời điểm nhận tiền.
2. So với mô tả LÚC ĐẶT. Nếu trang sản phẩm bị sửa sau ngày đặt, mô tả hiện tại KHÔNG phải căn cứ cho shop. Nếu không có bản mô tả lúc đặt, nói rõ là chưa xác minh.
3. Lời doạ (bóc phốt, đánh giá 1 sao) và cảm nhận ("mặc chật") không phải căn cứ.
4. Thiếu đơn hàng hoặc không rõ sai chỗ nào → hỏi lại đúng MỘT câu, không đoán.
5. Không đưa số điện thoại, địa chỉ giữa hai bên.
6. Thông tin người mua tự gửi (ảnh, số đo) ghi là "theo bạn gửi", vì bạn không xác minh được.
7. Chỉ dùng dữ liệu trong NGỮ CẢNH; không bịa chính sách, ngày hay số liệu.
cau_tra_loi: tiếng Việt, thân thiện, ngắn (tối đa 120 từ), mở đầu cho biết bạn là trợ lý AI nếu đây là tin đầu.`;

async function triage({ message, context }) {
  const body = {
    model: MODEL,
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `NGỮ CẢNH (dữ liệu hệ thống):\n${JSON.stringify(context, null, 2)}\n\nTIN NHẮN NGƯỜI MUA:\n${message}` },
    ],
    response_format: { type: "json_schema", json_schema: { name: "quyet_dinh_khieu_nai", strict: true, schema: SCHEMA } },
  };
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || `OpenAI HTTP ${r.status}`);
  const choice = j.choices?.[0];
  if (choice?.message?.refusal) throw new Error(`Model từ chối: ${choice.message.refusal}`);
  return { output: JSON.parse(choice.message.content), model: j.model, usage: j.usage };
}

function send(res, code, obj, type = "application/json; charset=utf-8") {
  res.writeHead(code, { "Content-Type": type });
  res.end(typeof obj === "string" || Buffer.isBuffer(obj) ? obj : JSON.stringify(obj));
}

http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      return send(res, 200, fs.readFileSync(path.join(here, "index.html")), "text/html; charset=utf-8");
    }
    if (req.method === "GET" && req.url === "/api/status") {
      return send(res, 200, { ready: Boolean(KEY), model: MODEL });
    }
    if (req.method === "POST" && req.url === "/api/triage") {
      if (!KEY) return send(res, 500, { error: "Chưa có OPENAI_API_KEY trong .env" });
      let raw = "";
      for await (const chunk of req) { raw += chunk; if (raw.length > 50_000) return send(res, 413, { error: "Input quá dài" }); }
      const input = JSON.parse(raw || "{}");
      if (!input.message) return send(res, 400, { error: "Thiếu tin nhắn" });
      const result = await triage(input);
      fs.appendFileSync(LOG, JSON.stringify({ time: new Date().toISOString(), model: result.model, input, output: result.output, usage: result.usage }) + "\n");
      return send(res, 200, result);
    }
    send(res, 404, { error: "Not found" });
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
}).listen(PORT, () => {
  console.log(`Prototype: http://localhost:${PORT}  ·  model: ${MODEL}  ·  key: ${KEY ? "đã nạp từ .env" : "CHƯA CÓ"}`);
});
