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

Tài khoản vừa đồng bộ **không lưu mật khẩu**: mật khẩu khởi tạo đúng bằng số điện thoại, mà số này chính là tên tài khoản nên không phải bí mật. Băm nó không bảo vệ thêm được gì trong khi băm vài nghìn tài khoản đủ làm một lần đồng bộ vượt trần thời gian chạy hàm. Ngay khi phụ huynh đặt mật khẩu riêng, hệ thống lưu hash `scrypt` và lối đăng nhập bằng số điện thoại tắt hẳn cho tài khoản đó.

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

## Chạy trên MySQL (máy chủ riêng)

Ngoài Firestore và SQLite, hệ thống chạy được trên MySQL 8.0 trở lên. Đây là nền dùng khi tự vận hành trên máy chủ của trường: không có hạn ngạch đọc/ghi theo ngày, dữ liệu nằm tại chỗ, sao lưu bằng `mysqldump`.

```powershell
$env:DATA_BACKEND="mysql"
$env:MYSQL_URL="mysql://nshm:mat-khau@127.0.0.1:3306/dkclb"
npm start
```

Bảng được tạo tự động theo `mysql-schema.sql` ngay lần chạy đầu. Dữ liệu mẫu **không** được tạo trừ khi đặt `NSHM_SEED_DEMO=1`, nên môi trường thật không bao giờ dính CLB minh họa.

MySQL còn chặt hơn Firestore ở khâu giữ chỗ: khi nhiều phụ huynh cùng giành chỗ cuối, giao dịch khóa dòng lớp bằng `SELECT ... FOR UPDATE` rồi mới đếm, nên số chỗ luôn tính từ dữ liệu thật và không cần bảng đếm riêng.

### Chuyển dữ liệu từ Firestore sang MySQL

1. Trên bản đang chạy, vào **Báo cáo & xuất file → Xuất toàn bộ dữ liệu** để tải file JSON.
2. Trên máy chủ mới, nạp file đó vào MySQL:

```bash
node backup-import.mjs NSHM_Clubs_backup_2026-08-21.json --url mysql://nshm:mat-khau@127.0.0.1:3306/dkclb
```

Script tự tạo bảng, nạp theo đúng thứ tự khóa ngoại, và **từ chối ghi đè** nếu cơ sở dữ liệu đích đã có dữ liệu (thêm `--replace` nếu thực sự muốn xóa sạch rồi nạp lại). Bản ghi trỏ tới dữ liệu không tồn tại — ví dụ đơn đăng ký của một lớp đã xóa — được bỏ qua và liệt kê ở cuối, thay vì làm hỏng cả lần nạp.

Số chỗ của từng lớp không được nạp vì MySQL tính trực tiếp từ đơn đăng ký; bộ kiểm thử có đối chiếu để chắc con số sau khi chuyển khớp với trước khi chuyển.

### Kiểm thử trên MySQL

Cùng một bộ kiểm thử nghiệp vụ chạy được trên cả hai nền. Trỏ `TEST_MYSQL_URL` vào một MySQL trống, mỗi file kiểm thử sẽ tự tạo và xóa database riêng:

```bash
TEST_MYSQL_URL="mysql://root@127.0.0.1:3306/" npm run test:mysql
```

Không đặt biến này thì `npm test` chạy trên SQLite và bỏ qua nhóm kiểm thử chuyển đổi dữ liệu.

## Mã hóa dữ liệu

Không có cấu hình nào là tuyệt đối an toàn. Mục tiêu cụ thể và kiểm chứng được của phần này là: **một bản sao cơ sở dữ liệu hoặc một file sao lưu rơi ra ngoài thì không đọc được nếu không có khóa**. Việc kẻ xấu chiếm được toàn quyền máy chủ vẫn là rủi ro còn lại, vì ứng dụng phải có khóa mới chạy được; rủi ro đó chỉ giảm bằng kỷ luật vận hành.

### File sao lưu

File sao lưu **luôn** được mã hóa. Người xuất đặt một mật khẩu tối thiểu 12 ký tự; dữ liệu được mã hóa **ngay trong trình duyệt** bằng AES-256-GCM với khóa dẫn xuất từ mật khẩu qua PBKDF2-SHA256 310.000 vòng, rồi mới ghi ra đĩa. Bản rõ không bao giờ nằm trên máy người dùng dưới dạng file.

Mất mật khẩu là mất luôn file sao lưu, không có đường khôi phục.

Khi nạp lại, script tự nhận biết tệp đã mã hóa:

```bash
BACKUP_PASSPHRASE="mat-khau-cua-ban" node backup-import.mjs ban-sao-luu.enc.json --url mysql://...
```

Nên dùng biến môi trường thay vì `--passphrase`, vì tham số dòng lệnh hiện ra trong danh sách tiến trình của máy chủ.

Cùng một module (`public/backup-crypto.mjs`) chạy ở cả trình duyệt lẫn Node, nên phần mã hóa lúc tải về và phần giải mã lúc nạp vào không thể lệch nhau, và kiểm thử chạy trong Node là kiểm thử đúng đoạn mã mà trình duyệt chạy.

### Khóa mã hóa dữ liệu

Sinh khóa mới:

```bash
node field-crypto.mjs --generate
```

Khóa dài 32 byte dạng base64, đặt vào `ENCRYPTION_KEY` hoặc lưu ở tệp riêng ngoài thư mục mã nguồn và trỏ tới bằng `ENCRYPTION_KEY_FILE`, với quyền NTFS chỉ cho tài khoản chạy dịch vụ đọc.

Từ khóa gốc, hệ thống dẫn xuất hai khóa con bằng HKDF: một khóa để mã hóa AES-256-GCM, và một khóa để sinh **chỉ mục mù** HMAC-SHA256. Chỉ mục mù là thứ cho phép vẫn tra cứu được theo số điện thoại mà không phải giải mã cả bảng, đồng thời không suy ngược ra bản rõ nếu không có khóa.

Mỗi lần mã hóa dùng IV ngẫu nhiên, nên cùng một cái tên ghi hai lần cho ra hai chuỗi khác nhau — nhìn vào cơ sở dữ liệu không biết được hai học sinh có trùng tên hay không.

**Đánh đổi cần biết:** khi mở MySQL Workbench, các cột đã mã hóa hiện ra chuỗi vô nghĩa. Muốn đọc dữ liệu thì phải qua ứng dụng.

## Sao lưu và xuất toàn bộ dữ liệu

Cổng Nhà trường → **Báo cáo & xuất file → Xuất toàn bộ dữ liệu**. Hệ thống tải về một file JSON chứa đủ mười nhóm dữ liệu: tài khoản, học sinh, liên kết phụ huynh–học sinh, đợt đăng ký, CLB, lớp, đơn đăng ký, yêu cầu hỗ trợ, nhật ký thao tác và bộ đếm chỗ.

Định dạng file **không phụ thuộc nền lưu trữ** (tên trường thống nhất kiểu camelCase), nên dùng được cho cả ba việc: sao lưu định kỳ, phương án xuất dữ liệu khẩn cấp, và chuyển hệ thống sang nền lưu trữ khác.

Hai điểm đáng lưu ý về cách làm:

- Xuất **theo từng trang** rồi ghép lại ngay trong trình duyệt, vì phản hồi của serverless function có giới hạn kích thước mà một trường vài nghìn học sinh thì thừa sức chạm trần.
- Việc ghi nhật ký thao tác là **không bắt buộc thành công**: xuất dữ liệu là thao tác chỉ đọc và phải chạy được cả khi cơ sở dữ liệu đang hết hạn ngạch ghi. Nếu không ghi được nhật ký, giao diện nói rõ điều đó thay vì im lặng.

File chứa thông tin cá nhân của học sinh và phụ huynh; chỉ lưu ở nơi an toàn của nhà trường.

## Hạn ngạch Cloud Firestore

Gói Firebase miễn phí (Spark) giới hạn khoảng **20.000 lượt ghi và 50.000 lượt đọc mỗi ngày**. Một lần đồng bộ danh bạ ghi mỗi học sinh, mỗi tài khoản phụ huynh và mỗi liên kết phụ huynh–học sinh, nên vài nghìn học sinh là đã dùng gần hết hạn mức ghi trong ngày. Khi hết hạn ngạch, các thao tác **ghi** bị từ chối trong khi **đọc** vẫn chạy — biểu hiện dễ gây hiểu nhầm nhất là phụ huynh nhập đúng mật khẩu nhưng không đăng nhập được, vì bước tạo phiên đăng nhập cần ghi.

Lúc đó hệ thống trả về thông báo *"Cơ sở dữ liệu đã dùng hết hạn ngạch trong ngày..."*. Hạn ngạch được đặt lại hằng ngày theo giờ Thái Bình Dương. Trước đợt đăng ký thật, nên chuyển dự án Firebase sang gói **Blaze (trả theo dùng)**: gói này giữ nguyên phần miễn phí và chỉ tính tiền phần vượt, vốn rất nhỏ ở quy mô một trường.

Đồng bộ chỉ ghi những bản ghi **thực sự thay đổi** so với dữ liệu đang có: chạy lại đúng một danh sách không đổi thì không tốn lượt ghi nào. Sau mỗi lần đồng bộ, hệ thống báo rõ đã ghi bao nhiêu bản ghi và bỏ qua bao nhiêu bản ghi không đổi, để theo dõi mức tiêu hạn ngạch.

## Phụ huynh không đăng nhập được

Cổng Nhà trường → **Cấu hình & phân quyền → Tra cứu tài khoản phụ huynh**. Nhập số điện thoại rồi bấm Tra cứu. Màn hình trả lời ba câu hỏi cùng lúc:

1. **Hệ thống đã có bao nhiêu tài khoản phụ huynh và lần đồng bộ gần nhất là khi nào.** Nếu hiện `Chưa từng chạy` thì chưa có tài khoản phụ huynh nào — cần chạy đồng bộ từ Google Sheets trước.
2. **Số này đã có tài khoản chưa.** Chưa có thường là do số chưa nằm trong Sheet, nằm ở cột không được nhận diện, hoặc được thêm vào Sheet sau lần đồng bộ gần nhất. Chạy lại đồng bộ là đủ.
3. **Nếu đã có tài khoản** thì đang ở trạng thái nào: còn dùng mật khẩu khởi tạo (chính là số điện thoại), đã đổi mật khẩu riêng, đang bị tạm khóa 15 phút do sai 5 lần, hay đã bị tắt. Kèm danh sách học sinh đã liên kết.

Khi phụ huynh quên mật khẩu, bấm **Đặt lại về mật khẩu khởi tạo**: mật khẩu trở lại chính là số điện thoại, khóa tạm được gỡ, và phụ huynh bắt buộc đổi mật khẩu ngay lần đăng nhập kế tiếp. Quản trị không tự đặt mật khẩu và hệ thống không bao giờ hiển thị mật khẩu hiện tại. Thao tác ghi audit log kèm người thực hiện.

## Khi sửa tệp trong `public/`

`index.html` được máy chủ đặt `max-age=0, must-revalidate` nên luôn tải bản mới, nhưng `app.js`, `styles.css` và `sheet-reader.js` được cache 4 giờ trong trình duyệt. **Mỗi lần sửa các tệp này phải nâng số phiên bản `?v=` trong `index.html`**, nếu không người dùng vẫn chạy mã cũ tới 4 giờ sau khi deploy. Quy ước hiện dùng là `?v=YYYYMMDD-n`.

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
