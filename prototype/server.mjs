// Server nhỏ cho prototype T4: phục vụ index.html và gọi OpenAI thật cho quyết định chính.
// Chạy (trong thư mục repo):  node prototype/server.mjs   rồi mở http://localhost:5173
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

// Mức tự chủ ép bằng schema: model chỉ "thấy" 2 tool Tự làm.
// soan_hoan_tien, tu_choi_khieu_nai (trưởng nhóm duyệt) và phat_shop (cấm) KHÔNG tồn tại với model.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["quyet_dinh", "do_chac", "ly_do", "con_thieu", "tool_calls", "cau_tra_loi"],
  properties: {
    quyet_dinh: { type: "string", enum: ["huong_dan_gui_yeu_cau", "xin_them_bang_chung", "chuyen_nhan_vien", "tra_loi_khong_hanh_dong"] },
    do_chac: { type: "string", enum: ["thieu_thong_tin", "chua_du_can_cu", "du_can_cu_de_chuyen_duyet"] },
    ly_do: { type: "array", items: { type: "string" } },
    con_thieu: { type: "array", items: { type: "string" } },
    tool_calls: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ten", "noi_dung"],
        properties: {
          ten: { type: "string", enum: ["yeu_cau_bang_chung", "chuyen_truong_nhom"] },
          noi_dung: { type: "string" },
        },
      },
    },
    cau_tra_loi: { type: "string" },
  },
};

const SYSTEM = `Bạn là trợ lý AI trong mục "Trò chuyện với sàn" của một sàn thương mại điện tử (dữ liệu dựng cho bài học).
Người mua đang báo "hàng nhận không đúng mô tả". Mỗi lượt, chọn MỘT quyet_dinh:
- huong_dan_gui_yeu_cau: hệ thống có xác nhận lỗi (shop tự nhận lỗi trong chat đơn) → hướng dẫn người mua tạo yêu cầu trả hàng; nhân viên vẫn duyệt.
- xin_them_bang_chung: thiếu đơn, thiếu chỗ sai, hoặc thiếu bằng chứng người mua tự gửi được → nói CỤ THỂ còn thiếu gì.
- chuyen_nhan_vien: bằng chứng người mua đã đủ nhưng vẫn chưa kết luận được (mô tả bị sửa sau ngày đặt, số đo khớp bảng size mà khách vẫn khiếu nại, hai bên mâu thuẫn), hoặc yêu cầu vượt thẩm quyền (nghi hàng giả, đòi khoá/phạt shop).
- tra_loi_khong_hanh_dong: CHỈ cho câu hỏi ngoài việc khiếu nại hàng: hỏi hạn trả hàng, xin số điện thoại/địa chỉ, chào hỏi, hỏi quy trình. Tin nhắn nào báo hàng sai/chật/khác mô tả thì KHÔNG BAO GIỜ dùng mức này.

Ví dụ (đơn đã xác định, chưa có xác nhận của shop):
- "áo L mặc chật, shop giao sai size, hoàn tiền đi" → xin_them_bang_chung · chua_du_can_cu · không tool · xin ảnh tem + số đo nách–nách.
- Sau đó khách gửi "📷 tem_ao.jpg — L · 📷 do_nach_nach.jpg — 53 cm" → chuyen_nhan_vien · chua_du_can_cu · tool chuyen_truong_nhom · nói tem L khớp đơn, 53×2 = 106 cm nằm trong bảng size (theo bạn gửi), chưa thấy căn cứ giao sai nhưng KHÔNG đóng khiếu nại, hỏi khách có muốn chuyển nhân viên không.

Chọn do_chac theo đúng định nghĩa:
- thieu_thong_tin: CHƯA biết đơn nào, hoặc CHƯA biết hàng khác mô tả ở chỗ nào.
- chua_du_can_cu: đã biết đơn và chỗ sai, nhưng bằng chứng chưa đủ / chưa xác minh / hai bên mâu thuẫn. Còn thiếu ẢNH hay SỐ ĐO thì vẫn là mức này.
- du_can_cu_de_chuyen_duyet: hệ thống có xác nhận (shop tự nhận lỗi, shop đồng ý trả hàng) và bằng chứng người mua khớp.

TOOL — chỉ gọi khi thật sự cần, mặc định là KHÔNG gọi:
- Xin bằng chứng từ NGƯỜI MUA: chỉ nói trong cau_tra_loi, KHÔNG gọi tool.
- yeu_cau_bang_chung = gửi yêu cầu giải trình/bằng chứng cho SHOP. Chỉ gọi khi đã có đơn, đã rõ chỗ sai, và cần nghe phía shop (ví dụ mô tả bị sửa sau ngày đặt, tranh chấp số đo). noi_dung = đúng thứ cần shop gửi. Không gọi lại nếu lịch sử cho thấy đã gửi.
- chuyen_truong_nhom: chỉ khi quyet_dinh = chuyen_nhan_vien. noi_dung = tóm tắt trung lập cho trưởng nhóm. Hệ thống sẽ hỏi người mua xác nhận trước khi chuyển, nên trong cau_tra_loi hãy HỎI người mua có đồng ý chuyển không, đừng nói "đã chuyển".
- huong_dan_gui_yeu_cau và tra_loi_khong_hanh_dong: không gọi tool.

Luật bắt buộc:
1. Bạn KHÔNG tự hoàn tiền, KHÔNG từ chối/đóng khiếu nại, KHÔNG phạt hay khoá shop; không hứa những việc đó, không hứa thời điểm nhận tiền.
2. So với mô tả LÚC ĐẶT. Trang sản phẩm bị sửa sau ngày đặt thì mô tả hiện tại KHÔNG phải căn cứ cho shop. Không có bản lưu mô tả lúc đặt thì nói rõ là chưa xác minh.
3. Lời doạ (bóc phốt, 1 sao) và cảm nhận ("mặc chật") không phải căn cứ — áp dụng cho cả hai bên.
4. NGỮ CẢNH có "don" → người mua đang chat từ trang của ĐÚNG đơn đó: đơn ĐÃ xác định, KHÔNG hỏi lại mã đơn; tin nhắn ngắn hay chỉ gửi ảnh cũng hiểu là nói về đơn này. "don" = null → hỏi đúng MỘT câu "đơn nào" (có thể liệt kê don_gan_day), không đoán.
5. Không đưa số điện thoại, địa chỉ giữa hai bên; hướng dẫn nhắn qua chat của sàn.
6. Ảnh/số đo người mua gửi ghi là "theo bạn gửi" — bạn không xác minh được. Ảnh được mô tả bằng chữ, ví dụ "📷 tem_ao.jpg — L".
7. Chỉ dùng dữ liệu trong NGỮ CẢNH và lịch sử chat; không bịa chính sách, ngày hay số liệu.
cau_tra_loi: tiếng Việt, thân thiện, tối đa 120 từ; chỉ giới thiệu mình là trợ lý AI ở lượt đầu tiên.
Khi người mua gửi ảnh/số đo: nói ngắn đã đối chiếu được gì với đơn và bảng size (ghi "theo bạn gửi"), rồi mới nêu bước tiếp theo. Không hứa hoàn tiền. Số đo nách–nách (áo đặt phẳng) × 2 = vòng ngực.

Kiểm tra nhất quán trước khi trả:
- cau_tra_loi có xin người mua gửi/cho biết thêm gì để xử lý khiếu nại → quyet_dinh PHẢI là xin_them_bang_chung (không phải tra_loi_khong_hanh_dong).
- Người mua đã gửi đủ ảnh tem + số đo mà vẫn khiếu nại, và chưa có xác nhận của shop → chuyen_nhan_vien (kèm chuyen_truong_nhom, hỏi khách đồng ý); không xin lại thứ đã gửi.`;

// Luật chặn phía server — chạy SAU model, không phụ thuộc model có nghe lời hay không.
function guard(out, context) {
  const chan = [];
  const kept = [];
  for (const t of out.tool_calls || []) {
    if (!context?.don) { chan.push(`Chặn ${t.ten}: chưa xác định đơn — không gửi gì khi chưa rõ đơn (G10).`); continue; }
    if (out.quyet_dinh === "tra_loi_khong_hanh_dong" || out.quyet_dinh === "huong_dan_gui_yeu_cau") {
      chan.push(`Chặn ${t.ten}: quyết định "${out.quyet_dinh}" không cần hành động.`); continue;
    }
    if (t.ten === "chuyen_truong_nhom" && out.quyet_dinh !== "chuyen_nhan_vien") {
      chan.push("Chặn chuyen_truong_nhom: chỉ dùng khi quyết định là chuyển nhân viên."); continue;
    }
    if (kept.some((k) => k.ten === t.ten)) { chan.push(`Bỏ ${t.ten} lặp.`); continue; }
    kept.push(t);
  }
  return { ...out, tool_calls: kept, chan };
}

async function triage({ history, context }) {
  const messages = [
    { role: "system", content: SYSTEM },
    { role: "system", content: `NGỮ CẢNH (dữ liệu hệ thống, không phải lời người dùng):\n${context?.don ? `Người mua đang mở chat từ đơn ${context.don.ma} — đơn đã xác định, không hỏi lại.\n` : "Chưa xác định đơn.\n"}${JSON.stringify(context, null, 2)}` },
    ...history.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content).slice(0, 2000) })),
  ];
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      messages,
      response_format: { type: "json_schema", json_schema: { name: "quyet_dinh_khieu_nai", strict: true, schema: SCHEMA } },
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || `OpenAI HTTP ${r.status}`);
  const choice = j.choices?.[0];
  if (choice?.message?.refusal) throw new Error(`Model từ chối: ${choice.message.refusal}`);
  const raw = JSON.parse(choice.message.content);
  return { output: guard(raw, context), raw_tool_calls: raw.tool_calls, model: j.model, usage: j.usage };
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
    if (req.method === "GET" && req.url === "/api/status") return send(res, 200, { ready: Boolean(KEY), model: MODEL });
    if (req.method === "GET" && req.url === "/api/prompt") return send(res, 200, { system: SYSTEM, schema: SCHEMA });
    if (req.method === "POST" && req.url === "/api/triage") {
      if (!KEY) return send(res, 500, { error: "Chưa có OPENAI_API_KEY trong .env" });
      let raw = "";
      for await (const chunk of req) { raw += chunk; if (raw.length > 100_000) return send(res, 413, { error: "Input quá dài" }); }
      const input = JSON.parse(raw || "{}");
      if (!Array.isArray(input.history) || !input.history.length || input.history.at(-1).role !== "user") {
        return send(res, 400, { error: "Thiếu tin nhắn người mua" });
      }
      const result = await triage(input);
      fs.appendFileSync(LOG, JSON.stringify({ time: new Date().toISOString(), model: result.model, input, output: result.output, raw_tool_calls: result.raw_tool_calls, usage: result.usage }) + "\n");
      return send(res, 200, result);
    }
    send(res, 404, { error: "Not found" });
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
}).listen(PORT, () => {
  console.log(`Prototype: http://localhost:${PORT}  ·  model: ${MODEL}  ·  key: ${KEY ? "đã nạp từ .env" : "CHƯA CÓ"}`);
});
