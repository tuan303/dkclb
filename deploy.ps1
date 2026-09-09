<#
.SYNOPSIS
  Triển khai dkclb lên máy chủ của trường: kéo mã, khởi động lại, tự nghiệm thu.

.DESCRIPTION
  Viết ra sau ba lần triển khai bằng tay, mỗi lần vướng đúng những chỗ này:

  1. Kéo mã TRƯỚC, tắt máy chủ SAU. Nếu `git pull` hỏng mà đã tắt rồi thì site nằm
     không vì lý do gì cả.
  2. Cây làm việc bẩn thì DỪNG. Thư mục public/ được đọc từ đĩa ở mỗi lượt truy
     cập, nên bất kỳ sửa tay nào trên máy chủ cũng đang chạy thật — `git pull` sẽ
     xoá nó hoặc xung đột giữa chừng.
  3. Chờ cổng NHẢ THẬT, không chờ theo đồng hồ. Tiến trình cũ chưa buông cổng là
     tiến trình mới chết ngay; đã xảy ra hai lần.
  4. Mỗi lần chạy ghi một tệp log riêng theo thời gian. `-RedirectStandardOutput`
     XOÁ TRẮNG tệp ngay khi sinh tiến trình, nên dùng chung một tên là mỗi lần bật
     lại lại xoá mất log của tiến trình đang chạy — đã mất log thật đúng lúc cần đọc.
  5. Nghiệm thu ở LOCAL trước, rồi mới ra ngoài. Cloudflare trả 522 khi máy chủ còn
     đang kết nối MySQL, nhìn giống hệt lỗi thật.

.EXAMPLE
  .\deploy.ps1
  Kéo nhánh mặc định rồi khởi động lại và nghiệm thu.

.EXAMPLE
  .\deploy.ps1 -SkipPull
  Chỉ khởi động lại, không đụng tới mã nguồn.
#>
[CmdletBinding()]
param(
  [string] $RepoPath  = $PSScriptRoot,
  [string] $Branch    = "self-hosted-migration",
  [int]    $Port      = 0,
  [string] $PublicUrl = "https://clb.nshm.vn",
  [string] $NodePath  = "C:\Program Files\nodejs\node.exe",
  [switch] $SkipPull,
  [switch] $Force
)

$ErrorActionPreference = "Continue"

function Write-Buoc  { param([string] $Text) Write-Host "`n=== $Text ===" -ForegroundColor Cyan }
function Write-Tot   { param([string] $Text) Write-Host "  [OK]   $Text" -ForegroundColor Green }
function Write-Nhac  { param([string] $Text) Write-Host "  [!]    $Text" -ForegroundColor Yellow }
function Dung-Lai {
  param([string] $Text)
  Write-Host "`n  [DUNG] $Text" -ForegroundColor Red
  Write-Host "  Máy chủ KHÔNG bị đụng tới nếu thông báo này xuất hiện trước bước Tắt.`n" -ForegroundColor Red
  exit 1
}

# Trả mã HTTP mà không ném lỗi. PowerShell 5.1 không có -SkipHttpErrorCheck, và
# Invoke-WebRequest ném ngoại lệ với mọi mã 4xx/5xx, nên phải bắt lại bằng tay.
function Get-MaHttp {
  param([string] $Url, [int] $TimeoutSec = 15)
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
    return [int] $response.StatusCode
  } catch {
    if ($_.Exception.Response) { return [int] $_.Exception.Response.StatusCode }
    return 0
  }
}

# Đọc tệp log trong khi node vẫn đang giữ nó. Get-Content thường sẽ kẹt hoặc lỗi.
function Doc-Log {
  param([string] $Path)
  if (-not (Test-Path $Path)) { return "" }
  try {
    $stream = [System.IO.File]::Open($Path, 'Open', 'Read', 'ReadWrite')
    $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
    $noiDung = $reader.ReadToEnd()
    $reader.Close(); $stream.Close()
    return $noiDung
  } catch { return "" }
}

function Lay-TienTrinhGiuCong {
  param([int] $Cong)
  $ket = Get-NetTCPConnection -LocalPort $Cong -State Listen -ErrorAction SilentlyContinue
  if (-not $ket) { return @() }
  return @($ket | Select-Object -ExpandProperty OwningProcess -Unique)
}

# ----------------------------------------------------------------------------

if (-not $RepoPath) { $RepoPath = (Get-Location).Path }
if (-not (Test-Path (Join-Path $RepoPath "server.mjs"))) {
  Dung-Lai "Không thấy server.mjs trong '$RepoPath'. Chạy script từ trong thư mục dkclb, hoặc truyền -RepoPath."
}
if (-not (Test-Path $NodePath)) {
  Dung-Lai "Không thấy node tại '$NodePath'. Truyền đường dẫn đúng qua -NodePath."
}
Set-Location $RepoPath

# Cổng: tham số → PORT trong .env → 4173. Đọc .env chứ không đoán, vì chính tệp đó
# là thứ máy chủ dùng lúc chạy.
if ($Port -le 0) {
  $Port = 4173
  $envFile = Join-Path $RepoPath ".env"
  if (Test-Path $envFile) {
    $dong = Select-String -Path $envFile -Pattern '^\s*PORT\s*=\s*(\d+)' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($dong) { $Port = [int] $dong.Matches[0].Groups[1].Value }
  }
}

Write-Buoc "Hiện trạng"
Write-Host "  Thư mục : $RepoPath"
Write-Host "  Cổng    : $Port"
$truocCommit = (git rev-parse --short HEAD)
Write-Host "  Commit  : $truocCommit"
$nodeDangChay = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue)
Write-Host ("  node.exe: {0} tiến trình" -f $nodeDangChay.Count)
foreach ($tienTrinh in $nodeDangChay) {
  Write-Host ("            PID {0} :: {1}" -f $tienTrinh.ProcessId, $tienTrinh.CommandLine)
}

# --- Kéo mã TRƯỚC khi tắt bất cứ thứ gì -------------------------------------
if (-not $SkipPull) {
  Write-Buoc "Kéo mã"
  $ban = (git status --porcelain)
  if ($ban -and -not $Force) {
    # Mỗi tệp một dòng: Write-Host thẳng mảng sẽ dồn hết vào một dòng, đúng lúc
    # người đọc cần thấy rõ những tệp nào đang bị đụng.
    $ban | ForEach-Object { Write-Host "    $_" }
    Dung-Lai "Cây làm việc có thay đổi chưa lưu. public/ được phục vụ thẳng từ đĩa nên những sửa đổi này ĐANG chạy thật. Xem kỹ rồi quyết định, hoặc chạy lại với -Force nếu chắc chắn bỏ chúng."
  }
  if ($ban) { Write-Nhac "Bỏ qua thay đổi chưa lưu vì có -Force." }

  git pull origin $Branch
  if ($LASTEXITCODE -ne 0) {
    Dung-Lai "git pull thất bại (mã $LASTEXITCODE). Máy chủ vẫn đang chạy bản cũ, chưa mất gì."
  }
  $sauCommit = (git rev-parse --short HEAD)
  if ($sauCommit -eq $truocCommit) {
    Write-Nhac "Mã không đổi ($sauCommit). Vẫn khởi động lại để chắc chắn tiến trình đang chạy đúng bản này."
  } else {
    Write-Tot "$truocCommit -> $sauCommit"
  }
} else {
  Write-Nhac "Bỏ qua bước kéo mã theo yêu cầu (-SkipPull)."
}

# --- Tắt ---------------------------------------------------------------------
Write-Buoc "Tắt máy chủ"
$giuCong = Lay-TienTrinhGiuCong -Cong $Port
if ($giuCong.Count -eq 0) {
  Write-Nhac "Không có tiến trình nào giữ cổng $Port (site đang nằm sẵn?)."
} else {
  # KHÔNG đặt tên biến tên pid: đó là biến tự động của PowerShell (id tiến trình
  # hiện tại) và chỉ đọc, gán vào là script chết ngay giữa bước tắt máy chủ.
  foreach ($idTienTrinh in $giuCong) {
    Write-Host "  Dừng PID $idTienTrinh"
    Stop-Process -Id $idTienTrinh -Force -ErrorAction SilentlyContinue
  }
}

# Chờ cổng nhả THẬT, hỏi lại từng giây thay vì ngủ một khoảng cố định rồi hy vọng.
$hetGio = (Get-Date).AddSeconds(30)
while ((Lay-TienTrinhGiuCong -Cong $Port).Count -gt 0 -and (Get-Date) -lt $hetGio) {
  Start-Sleep -Seconds 1
}
$conGiu = Lay-TienTrinhGiuCong -Cong $Port
if ($conGiu.Count -gt 0) {
  Dung-Lai ("Cổng {0} vẫn bị PID {1} giữ sau 30 giây. Kiểm tra tiến trình đó trước khi bật lại — bật lúc này là tiến trình mới chết ngay." -f $Port, ($conGiu -join ", "))
}
Write-Tot "Cổng $Port đã nhả."

# Cảnh báo tiến trình node lạc: cùng chạy server.mjs mà không giữ cổng nào, tức là
# một bản thứ hai đang chạy bộ lịch đồng bộ song song trên cùng cơ sở dữ liệu.
$conLai = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -like "*server.mjs*" })
if ($conLai.Count -gt 0) {
  # ${Port} chứ không phải $Port: dấu hai chấm ngay sau tên biến bị PowerShell hiểu
  # là cú pháp phạm vi biến, và script không chạy nổi.
  Write-Nhac ("Còn {0} tiến trình node chạy server.mjs nhưng không giữ cổng ${Port}:" -f $conLai.Count)
  foreach ($tienTrinh in $conLai) { Write-Host ("            PID {0} :: {1}" -f $tienTrinh.ProcessId, $tienTrinh.CommandLine) }
  Write-Nhac "Hai bản cùng chạy sẽ cùng đồng bộ danh bạ vào một cơ sở dữ liệu. Xem xét tắt chúng đi."
}

# --- Bật ---------------------------------------------------------------------
Write-Buoc "Bật máy chủ"
$thuMucLog = Join-Path $RepoPath "logs"
if (-not (Test-Path $thuMucLog)) { New-Item -ItemType Directory -Path $thuMucLog | Out-Null }
$dau = Get-Date -Format "yyyyMMdd-HHmmss"
$logRa  = Join-Path $thuMucLog "server-$dau.out.log"
$logLoi = Join-Path $thuMucLog "server-$dau.err.log"

# -WorkingDirectory là BẮT BUỘC: máy chủ nạp cấu hình từ .env trong thư mục repo.
# Bật từ chỗ khác thì DATA_BACKEND rơi về mặc định sqlite, site vẫn lên nhưng đọc
# một cơ sở dữ liệu rỗng — 4.445 học sinh biến mất mà không báo lỗi gì.
$thamSo = @{
  FilePath               = $NodePath
  ArgumentList           = "server.mjs"
  WorkingDirectory       = $RepoPath
  RedirectStandardOutput = $logRa
  RedirectStandardError  = $logLoi
  WindowStyle            = "Hidden"
  PassThru               = $true
}
# Truyền cổng cho tiến trình con, nếu không thì script kiểm một cổng còn máy chủ
# bám một cổng khác. Đã đo: loadEnvFile của Node KHÔNG ghi đè biến môi trường có
# sẵn, nên giá trị đặt ở đây thắng .env — và vì $Port mặc định vốn đọc từ chính
# .env nên trường hợp thường ngày hai bên vẫn khớp nhau.
$portCu = $env:PORT
$env:PORT = "$Port"
try {
  $tienTrinhMoi = Start-Process @thamSo
} finally {
  $env:PORT = $portCu
}
Write-Host "  PID $($tienTrinhMoi.Id), log: $logRa"

# --- Nghiệm thu tại chỗ ------------------------------------------------------
Write-Buoc "Nghiệm thu (trong máy chủ)"
$urlLocal = "http://127.0.0.1:$Port"
$hetGio = (Get-Date).AddSeconds(60)
$maLocal = 0
while ((Get-Date) -lt $hetGio) {
  if ($tienTrinhMoi.HasExited) {
    Write-Host (Doc-Log $logLoi)
    Dung-Lai "Tiến trình node đã thoát với mã $($tienTrinhMoi.ExitCode). Nội dung lỗi ở ngay trên và trong $logLoi."
  }
  $maLocal = Get-MaHttp -Url "$urlLocal/api/health" -TimeoutSec 5
  if ($maLocal -eq 200) { break }
  Start-Sleep -Seconds 2
}
if ($maLocal -ne 200) {
  Write-Host (Doc-Log $logLoi)
  Dung-Lai "Máy chủ không trả lời tại $urlLocal/api/health sau 60 giây (mã cuối: $maLocal)."
}

$health = Invoke-RestMethod -Uri "$urlLocal/api/health" -TimeoutSec 10
Write-Tot "Trang health trả lời. Nền lưu trữ: $($health.dataBackend)"
if ($health.dataBackend -ne "mysql") {
  Write-Nhac "Nền lưu trữ KHÔNG phải mysql. Kiểm tra tệp .env — chạy sai nền là danh sách học sinh rỗng."
}

# --- Nghiệm thu từ ngoài -----------------------------------------------------
Write-Buoc "Nghiệm thu (từ Internet)"
$maChu = Get-MaHttp -Url "$PublicUrl/" -TimeoutSec 20
if ($maChu -eq 200) {
  Write-Tot "$PublicUrl trả 200."
} elseif ($maChu -eq 522) {
  Write-Nhac "522: Cloudflare chưa gọi được vào máy chủ. Máy chủ ở local đã tốt, thường chỉ cần chờ vài giây rồi thử lại."
} else {
  Write-Nhac "$PublicUrl trả $maChu."
}

Write-Buoc "Tóm tắt"
Write-Host "  Commit  : $(git rev-parse --short HEAD)"
Write-Host "  PID     : $($tienTrinhMoi.Id)"
Write-Host "  Cổng    : $Port"
Write-Host "  Log ra  : $logRa"
Write-Host "  Log lỗi : $logLoi"
Write-Host ""
