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
- Chỉ hiển thị lớp thuộc đợt đăng ký đang mở, kèm hạn nộp và đếm ngược theo giờ máy chủ.
- Kiểm tra điều kiện khối, đăng ký trùng CLB, giao nhau lịch học và giới hạn số CLB của đợt.
- Đăng ký lớp còn chỗ hoặc vào danh sách chờ khi lớp đầy.
- Thời khóa biểu tuần theo từng học sinh, kèm phòng, giáo viên và trạng thái từng đơn.
- Theo dõi trạng thái kèm hướng dẫn việc cần làm tiếp, và gửi yêu cầu hỗ trợ.

### Cổng Nhà trường

- Giao diện đăng nhập Microsoft 365 bằng Authorization Code Flow + PKCE, giới hạn đúng tenant và tên miền `@hoangmaistarschool.edu.vn`.
- Dashboard lấy dữ liệu trực tiếp từ cơ sở dữ liệu.
- **Quản trị đợt đăng ký:** tạo/sửa đợt, đặt thời gian mở–đóng theo giờ Việt Nam, giới hạn số CLB mỗi học sinh, mở/đóng đăng ký. Hệ thống tự ngừng nhận đơn khi hết hạn và chỉ cho phép một đợt mở tại một thời điểm.
- **Quản trị CLB và lớp:** tạo/sửa CLB, thêm nhiều ca học cho một CLB (mỗi ca có lịch, phòng, giáo viên, sĩ số, học phí và khối áp dụng riêng), ngừng mở hoặc mở lại từng ca.
- **Nhập danh mục hàng loạt từ Excel/CSV** với bước rà soát trước khi ghi.
- Chốt an toàn khi sửa danh mục: không hạ sĩ số xuống dưới số chỗ đã dùng, không ngừng mở lớp đang có đơn hiệu lực, không xếp hai lớp trùng phòng cùng khung giờ trong một đợt.
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

## Quản trị danh mục và nhập từ Excel

Trong cổng Nhà trường:

1. **Đợt đăng ký → + Tạo đợt đăng ký.** Đặt tên, năm học, học kỳ, thời gian mở–đóng (giờ Việt Nam) và số CLB tối đa mỗi học sinh. Đợt ở trạng thái `Bản nháp` chưa hiển thị với phụ huynh.
2. **CLB & lịch học → + Tạo CLB**, sau đó thêm từng ca học. Một CLB có thể có nhiều ca khác thứ, khác phòng, khác khối áp dụng.
3. **CLB & lịch học → Nhập từ Excel** để khai hàng loạt.

File nhập có **mỗi dòng là một ca học**; các dòng cùng mã hoặc cùng tên CLB được gộp thành một CLB nhiều ca. Cột bắt buộc:

| Cột | Ví dụ giá trị chấp nhận |
|---|---|
| Tên CLB | `Guitar` |
| Khối | `3-5`, `1,2,3`, `Khối 6-9` |
| Thứ | `Thứ 2`, `T2`, `2`, `CN`, `Monday` |
| Khung giờ | `16:15-17:30`, `16h15 – 17h30` (hoặc tách hai cột Giờ bắt đầu / Giờ kết thúc) |
| Phòng | `Phòng Nhạc 2` |
| Giáo viên | `Thầy Sơn` |
| Sĩ số | `14` |
| Học phí | `1.500.000`, `1500000` |

Cột tùy chọn: `Mã CLB`, `Nhóm môn`, `Tên lớp`, `Mô tả`, `Biểu tượng`, `Sĩ số tối thiểu`.

File `.xlsx` được đọc ngay trong trình duyệt (không tải file lên máy chủ). Máy chủ chỉ nhận bảng dữ liệu đã đọc, tự nhận diện cột, kiểm tra từng dòng rồi trả về bản rà soát: số dòng hợp lệ, dòng lỗi kèm lý do, cảnh báo trùng phòng và trùng ca. Chỉ khi không còn dòng lỗi mới xuất hiện nút ghi vào hệ thống. Thao tác ghi **chỉ thêm hoặc cập nhật** theo mã CLB và khung lịch, không xóa CLB hay lớp đang có, và được ghi vào audit log.

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

Chạy toàn bộ:

```powershell
npm test
```

Bộ kiểm thử hiện bao phủ:

- Health check.
- Phạm vi dữ liệu phụ huynh-học sinh.
- Lọc điều kiện CLB theo khối, kể cả khối khai riêng cho từng ca.
- Chặn trùng lịch với đăng ký hiện có và chặn hai ca của cùng một CLB.
- Tạo đơn danh sách chờ.
- Dashboard và xác nhận phí của admin.
- Đọc dữ liệu danh mục: thứ, giờ (kể cả số thực của Excel), khối, học phí.
- Quản trị đợt: chặn mở hai đợt cùng lúc, chặn thời gian đóng trước thời gian mở, đóng đợt là ngừng nhận đơn ngay.
- Quản trị lớp: chặn trùng phòng, chặn hạ sĩ số dưới số chỗ đã dùng, chặn ngừng mở lớp đang có đơn.
- Nhập danh mục: rà soát trước khi ghi, gộp CLB nhiều ca, nhập lại cùng file thì cập nhật chứ không nhân đôi.
- Phân quyền: phụ huynh không đọc/ghi được API quản trị.

## Chạy bằng Docker

```powershell
docker compose up --build
```

Ứng dụng chạy tại `http://localhost:4173`; dữ liệu SQLite được lưu trong volume `nshm-club-data`.

## Cấu trúc dự án

```text
.
├── public/                       # Thư mục DUY NHẤT được phục vụ tĩnh ra Internet
│   ├── index.html                # Khung giao diện và đăng nhập
│   ├── styles.css                # Design system responsive
│   ├── app.js                    # Trạng thái UI và kết nối API
│   ├── sheet-reader.js           # Đọc .xlsx/.csv ngay trong trình duyệt
│   └── firebase-client.js        # Firebase Web app và Analytics
├── server.mjs                    # HTTP server, API, auth và rule engine
├── catalog-schema.mjs            # Chuẩn hóa/kiểm tra đợt, CLB, lớp và dữ liệu nhập
├── api/index.mjs                 # Vercel Function duy nhất cho toàn bộ API
├── firestore-store.mjs           # Google Cloud Firestore SDK phía backend
├── google-cloud-auth.mjs         # Vercel OIDC → Google Workload Identity
├── sheets-directory.mjs          # Connector Sheets chỉ đọc và kiểm tra mapping
├── firestore.rules               # Chặn truy cập dữ liệu trực tiếp từ client
├── tests/api.test.mjs            # Kiểm thử tích hợp API
├── tests/catalog-api.test.mjs    # Kiểm thử tích hợp quản trị danh mục
├── tests/catalog-schema.test.mjs # Kiểm thử chuẩn hóa dữ liệu danh mục
├── docs/TECHNICAL_ARCHITECTURE.md
├── BA_CAU_TRUC_HE_THONG_CLB.md
├── Dockerfile
└── docker-compose.yml
```

## Tài liệu

- [Cấu trúc nghiệp vụ BA](./BA_CAU_TRUC_HE_THONG_CLB.md)
- [Kiến trúc kỹ thuật](./docs/TECHNICAL_ARCHITECTURE.md)
- [Thiết kế đồng bộ Google Sheets an toàn](./docs/GOOGLE_SHEETS_SYNC_SECURITY.md)

## Phụ huynh không đăng nhập được

Cổng Nhà trường → **Cấu hình & phân quyền → Tra cứu tài khoản phụ huynh**. Nhập số điện thoại rồi bấm Tra cứu. Màn hình trả lời ba câu hỏi cùng lúc:

1. **Hệ thống đã có bao nhiêu tài khoản phụ huynh và lần đồng bộ gần nhất là khi nào.** Nếu hiện `Chưa từng chạy` thì chưa có tài khoản phụ huynh nào — cần chạy đồng bộ từ Google Sheets trước.
2. **Số này đã có tài khoản chưa.** Chưa có thường là do số chưa nằm trong Sheet, nằm ở cột không được nhận diện, hoặc được thêm vào Sheet sau lần đồng bộ gần nhất. Chạy lại đồng bộ là đủ.
3. **Nếu đã có tài khoản** thì đang ở trạng thái nào: còn dùng mật khẩu khởi tạo (chính là số điện thoại), đã đổi mật khẩu riêng, đang bị tạm khóa 15 phút do sai 5 lần, hay đã bị tắt. Kèm danh sách học sinh đã liên kết.

Khi phụ huynh quên mật khẩu, bấm **Đặt lại về mật khẩu khởi tạo**: mật khẩu trở lại chính là số điện thoại, khóa tạm được gỡ, và phụ huynh bắt buộc đổi mật khẩu ngay lần đăng nhập kế tiếp. Quản trị không tự đặt mật khẩu và hệ thống không bao giờ hiển thị mật khẩu hiện tại. Thao tác ghi audit log kèm người thực hiện.

## Ranh giới tệp công khai

Chỉ thư mục `public/` được phục vụ ra Internet. `vercel.json` khai báo `"outputDirectory": "public"`, và server local cũng chỉ đọc tệp trong thư mục đó theo một danh sách trắng.

Mọi thứ ngoài `public/` — mã nguồn backend `.mjs`, `firestore.rules`, `package.json`, tài liệu BA nội bộ — **không** được truy cập qua HTTP. Khi thêm tệp giao diện mới, đặt vào `public/` và bổ sung tên tệp vào `PUBLIC_FILES` trong `server.mjs`; bộ kiểm thử có một test chặn hồi quy cho ranh giới này.

## Giới hạn MVP

- Chưa gửi OTP, email, SMS hoặc Zalo thật.
- Chưa tích hợp cổng thanh toán hay hệ thống kế toán/SIS.
- Đã có CRUD cho đợt/CLB/lớp; chưa có CRUD cho tài khoản và phân quyền theo vai trò chi tiết (hiện chỉ hai vai trò `parent` và `admin`).
- Chưa có luồng đổi/hủy đơn, tự động gọi danh sách chờ khi có chỗ trống, khóa và xuất danh sách chính thức.
- Trang Đối soát phí và Báo cáo vẫn là giao diện minh họa; mới có xác nhận phí từng đơn và xuất CSV.
- SQLite chỉ dùng cho demo local và kiểm thử; Production dùng Firestore phân tán.
- Chưa có bước duyệt thay đổi dữ liệu theo từng dòng trước khi đồng bộ hàng loạt từ Sheet.
