# NSHM Clubs

MVP full-stack cho quy trình đăng ký câu lạc bộ ngoại khóa của Trường Ngôi Sao Hoàng Mai. Hệ thống giữ nguyên định hướng giao diện mobile-first của prototype và bổ sung API, xác thực theo phiên, kiểm tra nghiệp vụ phía server, Cloud Firestore và SQLite dự phòng cho phát triển/kiểm thử.

## Chức năng đã triển khai

### Cổng Phụ huynh

- Đăng nhập bằng tài khoản demo và duy trì phiên làm việc bằng cookie `HttpOnly`.
- Chuẩn hóa SĐT từ Sheet: `912345678` thành tài khoản `0912345678`; cùng một SĐT tự động liên kết nhiều con.
- Khi tạo tài khoản từ Sheet, SĐT là mật khẩu **khởi tạo một lần** và phụ huynh bắt buộc đổi sang mật khẩu riêng tối thiểu 8 ký tự, có chữ hoa, chữ thường, số và ký tự đặc biệt.
- Khóa tạm 15 phút sau 5 lần đăng nhập sai liên tiếp.
- Chỉ xem học sinh đã liên kết với tài khoản.
- Lọc CLB theo học sinh, nhóm môn và tình trạng quota.
- Kiểm tra điều kiện khối, đăng ký trùng, giao nhau lịch học và giới hạn số CLB.
- Đăng ký lớp còn chỗ hoặc vào danh sách chờ khi lớp đầy.
- Theo dõi trạng thái, lịch học và gửi yêu cầu hỗ trợ.

### Cổng Nhà trường

- Giao diện đăng nhập Microsoft 365 bằng Authorization Code Flow + PKCE, giới hạn đúng tenant và tên miền `@hoangmaistarschool.edu.vn`.
- Dashboard lấy dữ liệu trực tiếp từ cơ sở dữ liệu.
- Danh sách CLB/lớp, quota, học phí và tỷ lệ lấp đầy.
- Lọc đơn theo trạng thái và tìm kiếm.
- Xác nhận phí với kiểm tra chuyển trạng thái và audit log.
- Xuất báo cáo đăng ký CSV từ server.
- Hiển thị cấu trúc module và ma trận phân quyền đề xuất.
- Kiểm tra kết nối Google Sheets ở chế độ chỉ đọc, tự nhận diện mapping cột và thống kê lỗi nguồn mà không trả dữ liệu cá nhân về log.

## Chạy ứng dụng

Yêu cầu Node.js `22.5+`.

```powershell
pnpm install
pnpm start
```

Mở [http://127.0.0.1:4173](http://127.0.0.1:4173).

Các lệnh hỗ trợ nếu sử dụng npm:

```powershell
npm run dev
npm test
npm run check
```

## Tài khoản demo

| Cổng | Tài khoản | Mật khẩu/OTP |
|---|---|---|
| Phụ huynh | `0901234567` | `123456` |
| Nhà trường | `admin@nshm.edu.vn` | `Admin@123` |

Các tài khoản này chỉ dùng cho demo. Luồng production dùng mật khẩu khởi tạo một lần cho phụ huynh và Microsoft 365 SSO cho nhà trường.

## Cấu hình Microsoft 365

Tạo **App registration** trong Microsoft Entra ID của trường, chọn mô hình single-tenant và thêm Redirect URI loại **Web**. Production dùng Vercel OIDC Federated Credential nên không tạo và không lưu Client Secret:

```text
MICROSOFT_TENANT_ID=<Directory tenant ID>
MICROSOFT_CLIENT_ID=<Application client ID>
MICROSOFT_REDIRECT_URI=https://clb.nshm.vn/api/auth/microsoft/callback
MICROSOFT_ALLOWED_DOMAIN=hoangmaistarschool.edu.vn
```

Redirect URI trên Entra ID phải khớp tuyệt đối với biến môi trường. Ở production, đổi thành URL HTTPS thật. Backend xác thực cả `tid` (tenant) và hậu tố email; frontend không nhận hoặc lưu access token Microsoft.

## Chạy với Cloud Firestore

Frontend đã dùng Firebase Web config của dự án `dkclb-2626f` để khởi tạo ứng dụng và Analytics. Dữ liệu nghiệp vụ không được ghi trực tiếp từ trình duyệt; Firestore Rules chặn toàn bộ client và chỉ backend được IAM cho phép truy cập.

1. Bật Cloud Firestore trong Firebase Console của dự án `dkclb-2626f`.
2. Cấp service account quyền `Cloud Datastore User` và quyền đọc Sheet bằng cách share Viewer.
3. Kết nối Vercel Production với service account qua Workload Identity Federation và Vercel OIDC.
4. Cấu hình các biến Production trong Vercel:

```powershell
DATA_BACKEND=firestore
FIREBASE_PROJECT_ID=dkclb-2626f
GCP_PROJECT_NUMBER=810121949696
GCP_SERVICE_ACCOUNT_EMAIL=nshm-sheet-reader@dkclb-2626f.iam.gserviceaccount.com
GCP_WORKLOAD_IDENTITY_POOL_ID=vercel
GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID=vercel
```

Lần kết nối đầu tiên, backend tạo catalog CLB và các collection cần thiết. Production đọc/ghi tài khoản, liên kết phụ huynh–học sinh, phiên đăng nhập, trạng thái OAuth, đơn đăng ký, hỗ trợ và audit trực tiếp trong Firestore. Token phiên chỉ được lưu dưới dạng SHA-256; cookie gốc là `HttpOnly`, `Secure`, `SameSite=Lax`.

Production không dùng service-account JSON hoặc private key dài hạn. Máy local vẫn có thể dùng ADC ngắn hạn khi cần kiểm tra.

Để triển khai Firestore Rules và indexes sau khi đăng nhập Firebase CLI:

```powershell
firebase deploy --only firestore
```

Rules hiện chặn toàn bộ truy cập client; backend Admin SDK được kiểm soát bằng IAM.

## Kết nối Google Sheets

Nguồn danh sách học sinh đã được cấu hình:

- Spreadsheet ID: `1YUCh0_U8ASCf4nVMZ_dXj9EAkEGq9ghpHggiYVT1zeM`
- Tab: `dshs26-27`
- Dòng tiêu đề: `1`
- Service account: `nshm-sheet-reader@dkclb-2626f.iam.gserviceaccount.com`

Trong cổng Nhà trường, mở **Cấu hình & phân quyền → Google Sheets → Kiểm tra kết nối**. Backend dùng scope `spreadsheets.readonly`, đọc metadata trước rồi đọc phạm vi giới hạn tối đa 100 dòng để xác nhận mapping. Khi kiểm tra hợp lệ, nút **Đồng bộ học sinh & tài khoản PH** sẽ xuất hiện. Đồng bộ chỉ thêm/cập nhật dữ liệu hệ thống, không sửa Google Sheet và không tự xóa tài khoản cũ.

Tài khoản PH mới được tạo theo quy tắc `912345678` → `0912345678`; mật khẩu khởi tạo cũng là `0912345678` và phải đổi ngay lần đầu. Các lần đồng bộ sau không đặt lại mật khẩu đã đổi.

Biến môi trường có thể thay đổi nguồn mà không sửa code:

```text
GOOGLE_SHEETS_SPREADSHEET_ID
GOOGLE_SHEETS_TAB
GOOGLE_SHEETS_HEADER_ROW
GOOGLE_SHEETS_SERVICE_ACCOUNT
```

Để nút kiểm tra đọc được Sheet, service account phải được share Viewer và runtime phải nhận danh tính ngắn hạn. Production đổi Vercel OIDC token thành access token Google qua Workload Identity Federation; không dùng khóa JSON dài hạn.

Trên máy phát triển, phương án an toàn là cài Google Cloud CLI rồi dùng service-account impersonation với credential ngắn hạn:

```powershell
gcloud auth application-default login --impersonate-service-account=nshm-sheet-reader@dkclb-2626f.iam.gserviceaccount.com --scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/spreadsheets.readonly
```

Tài khoản thực hiện lệnh cần quyền `Service Account Token Creator` trên service account. Khởi động lại ứng dụng sau khi xác thực xong.

## Dữ liệu cục bộ

- Backend mặc định là `sqlite`, phù hợp chạy nhanh và kiểm thử.
- File SQLite mặc định: `data/nshm-clubs.sqlite`.
- CSDL và dữ liệu mẫu được tạo tự động trong lần chạy đầu tiên.
- Các file SQLite đã được loại khỏi Git bằng `.gitignore`.
- Có thể chỉ định vị trí khác qua biến môi trường `DATA_FILE`.

## Kiểm thử

```powershell
node --test tests/api.test.mjs
```

Bộ kiểm thử hiện bao phủ:

- Health check.
- Phạm vi dữ liệu phụ huynh-học sinh.
- Lọc điều kiện CLB theo khối.
- Chặn trùng lịch với đăng ký hiện có.
- Tạo đơn danh sách chờ.
- Dashboard và xác nhận phí của admin.

## Chạy bằng Docker

```powershell
docker compose up --build
```

Ứng dụng chạy tại `http://localhost:4173`; dữ liệu SQLite được lưu trong volume `nshm-club-data`.

## Cấu trúc dự án

```text
.
├── index.html                    # Khung giao diện và đăng nhập
├── styles.css                    # Design system responsive
├── app.js                        # Trạng thái UI và kết nối API
├── server.mjs                    # HTTP server, API, auth và rule engine
├── api/index.mjs                 # Vercel Function duy nhất cho toàn bộ API
├── firestore-store.mjs           # Google Cloud Firestore SDK phía backend
├── google-cloud-auth.mjs         # Vercel OIDC → Google Workload Identity
├── sheets-directory.mjs          # Connector Sheets chỉ đọc và kiểm tra mapping
├── firebase-client.js            # Firebase Web app và Analytics
├── firestore.rules               # Chặn truy cập dữ liệu trực tiếp từ client
├── tests/api.test.mjs            # Kiểm thử tích hợp API
├── docs/TECHNICAL_ARCHITECTURE.md
├── BA_CAU_TRUC_HE_THONG_CLB.md
├── Dockerfile
└── docker-compose.yml
```

## Tài liệu

- [Cấu trúc nghiệp vụ BA](./BA_CAU_TRUC_HE_THONG_CLB.md)
- [Kiến trúc kỹ thuật](./docs/TECHNICAL_ARCHITECTURE.md)
- [Thiết kế đồng bộ Google Sheets an toàn](./docs/GOOGLE_SHEETS_SYNC_SECURITY.md)

## Giới hạn MVP

- Chưa gửi OTP, email, SMS hoặc Zalo thật.
- Chưa tích hợp cổng thanh toán hay hệ thống kế toán/SIS.
- Chưa có giao diện CRUD đầy đủ cho CLB, lịch, tài khoản và phân quyền.
- SQLite chỉ dùng cho demo local và kiểm thử; Production dùng Firestore phân tán.
- Chưa có bước duyệt thay đổi dữ liệu theo từng dòng trước khi đồng bộ hàng loạt từ Sheet.
