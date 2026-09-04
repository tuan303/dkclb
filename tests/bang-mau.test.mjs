// Bảng màu giao diện phải bám đúng màu nhận diện của trường, và chữ trên nền màu
// phải đủ tương phản để đọc được.
//
// Tông nhạt của trường (#C7F1C0, #FFEBD6) đậm hơn tông gần-trắng của thiết kế cũ,
// nên khi đổi bảng màu có hai nhãn trạng thái tụt xuống dưới chuẩn. Kiểm thử này
// tính tỉ lệ tương phản từ chính tệp CSS, để lần sau ai đổi màu là biết ngay.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
const root = css.slice(css.indexOf(":root"), css.indexOf("}", css.indexOf(":root")));
const bien = Object.fromEntries(
  [...root.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,6})/g)].map((m) => [m[1], m[2].toLowerCase()]),
);

function doSang(hex) {
  const kenh = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * kenh[0] + 0.7152 * kenh[1] + 0.0722 * kenh[2];
}

function tyLeTuongPhan(chu, nen) {
  const [sang, toi] = [doSang(chu), doSang(nen)].sort((a, b) => b - a);
  return (sang + 0.05) / (toi + 0.05);
}

test("bốn màu chính lấy nguyên từ bảng nhận diện", () => {
  assert.equal(bien.navy, "#23328c");
  assert.equal(bien.red, "#d21235");
  assert.equal(bien.green, "#2da037");
  assert.equal(bien.gold, "#ffad00");
});

test("màu hành động chính là xanh, không phải đỏ", () => {
  // Đỏ là màu nhận diện mạnh nhất của trường, nhưng trong hệ thống này đỏ đang
  // mang nghĩa CẢNH BÁO: trùng lịch, đã hủy, đã vô hiệu hoá. Dùng đỏ cho cả nút
  // bấm chính lẫn trạng thái lỗi sẽ làm mất nghĩa của cả hai.
  assert.equal(bien.blue, "#23328c");
  assert.notEqual(bien.blue, bien.red);
});

test("tông nhạt dùng đúng màu phụ của trường", () => {
  assert.equal(bien["green-soft"], "#c7f1c0");
  assert.equal(bien["gold-soft"], "#ffebd6");
});

test("chữ trắng trên nút chính và trên nền đỏ đều đọc được", () => {
  for (const [ten, nen] of [["nút chính", bien.blue], ["nền đỏ", bien.red]]) {
    const r = tyLeTuongPhan("#ffffff", nen);
    assert.ok(r >= 4.5, `chữ trắng trên ${ten} (${nen}) chỉ đạt ${r.toFixed(2)}, cần 4.5`);
  }
});

test("mọi nhãn trạng thái đạt chuẩn WCAG AA", () => {
  // Đọc thẳng từ CSS chứ không gõ tay, để test không lệch khi ai đó sửa màu.
  const nhan = [...css.matchAll(/\.badge-(\w+)\s*\{\s*color:\s*(#[0-9a-fA-F]{6});\s*background:\s*var\(--([\w-]+)\)/g)];
  assert.ok(nhan.length >= 4, `chỉ đọc được ${nhan.length} nhãn trạng thái từ CSS`);

  for (const [, ten, chu, tenBienNen] of nhan) {
    const nen = bien[tenBienNen];
    assert.ok(nen, `nhãn ${ten} dùng biến --${tenBienNen} không có trong :root`);
    const r = tyLeTuongPhan(chu, nen);
    assert.ok(r >= 4.5, `nhãn ${ten}: chữ ${chu} trên ${nen} chỉ đạt ${r.toFixed(2)}, cần 4.5`);
  }
});

test("không còn màu xanh ngọc của thiết kế cũ trong bảng biến", () => {
  // Thiết kế cũ dùng xanh ngọc làm màu phụ; bảng nhận diện của trường không có
  // tông đó. Sót lại một biến xanh ngọc là dấu hiệu đổi màu chưa trọn.
  for (const [ten, hex] of Object.entries(bien)) {
    if (!/^#[0-9a-f]{6}$/.test(hex)) continue;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max - min < 20) continue;
    let h;
    if (max === r) h = 60 * ((((g - b) / (max - min)) % 6) + 6) % 360;
    else if (max === g) h = 60 * ((b - r) / (max - min) + 2);
    else h = 60 * ((r - g) / (max - min) + 4);
    assert.ok(h < 150 || h > 200, `biến --${ten} (${hex}) đang ở vùng xanh ngọc, sắc độ ${Math.round(h)}`);
  }
});
