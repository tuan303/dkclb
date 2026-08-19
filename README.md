# NSHM Clubs — Prototype cấu trúc phần mềm

Prototype tĩnh, responsive, được dựng từ yêu cầu nghiệp vụ trong đề bài đăng ký CLB ngoại khóa. Dữ liệu trong demo hoàn toàn là dữ liệu minh họa.

## Mở demo

Cách nhanh nhất: mở trực tiếp `index.html` bằng Chrome hoặc Edge.

Nếu trình duyệt chặn một số hành vi khi mở file cục bộ, chạy web server đơn giản trong thư mục này:

```powershell
python -m http.server 4173
```

Sau đó truy cập `http://localhost:4173`.

## Kịch bản nên thử

1. Ở vai trò **Phụ huynh**, chọn học sinh Nguyễn Minh An.
2. Mở **Khám phá CLB** và chọn Bóng rổ.
3. Thử chọn Piano để thấy kiểm tra trùng lịch với Bóng rổ.
4. Chọn Mỹ thuật sáng tạo để thấy luồng vào danh sách chờ.
5. Mở giỏ, xác nhận cam kết và gửi đăng ký.
6. Chuyển sang vai trò **Nhà trường**.
7. Xem Dashboard, lọc Đơn đăng ký, xác nhận phí và xuất CSV demo.
8. Mở **Cấu trúc hệ thống** để xem 6 domain chức năng của MVP.

## Phạm vi demo

- Mô phỏng front-end, không có backend/CSDL thật.
- Không gửi OTP, email, SMS, Zalo hoặc thanh toán thật.
- Không sử dụng dữ liệu học sinh/phụ huynh thật.
- Logic trùng lịch, sĩ số, trạng thái và xuất CSV được mô phỏng trên trình duyệt.

Xem thêm `BA_CAU_TRUC_HE_THONG_CLB.md` để có mô hình nghiệp vụ, dữ liệu, phân quyền, backlog và các quyết định cần chốt.
