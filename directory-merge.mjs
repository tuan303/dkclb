// Gộp danh sách học sinh đọc từ NHIỀU file Google Sheet thành MỘT ảnh chụp duy nhất.
//
// Vì sao phải gộp trước rồi mới đối chiếu, thay vì đồng bộ từng file rời rạc:
//
//   Em lớp 5 sang năm nằm ở file THCS và biến mất khỏi file Tiểu học. Nếu xử lý
//   từng file và coi "vắng mặt trong file này = nghỉ học", em đó sẽ bị vô hiệu
//   hóa rồi tạo lại thành một người mới — mất hết liên kết phụ huynh và lịch sử
//   đăng ký. Gộp cả ba file lại thì em vẫn có mặt, chỉ là đổi cấp.
//
// Một phụ huynh cũng có thể có con ở hai cấp khác nhau, nên tài khoản phụ huynh
// phải được gộp theo số điện thoại và hợp nhất danh sách con từ mọi nguồn.

function mergeError(code, message, details) {
  const error = new Error(message);
  Object.assign(error, { status: 409, code, details, expose: true });
  return error;
}

/**
 * @param results  mảng kết quả đọc từng nguồn:
 *                 { key, label, ok, snapshot?: { students, guardians }, analysis?, error? }
 */
export function mergeDirectorySnapshots(results = []) {
  const sources = [];
  const studentsByCode = new Map();
  const guardiansByAccount = new Map();
  const duplicates = [];

  for (const result of results) {
    const source = {
      key: result.key,
      label: result.label,
      ok: Boolean(result.ok),
      students: 0,
      guardians: 0,
      error: result.ok ? null : (result.error || "Không đọc được nguồn dữ liệu."),
      scannedRows: result.analysis?.scannedRows ?? 0,
      issues: result.analysis?.issues ?? [],
    };

    if (result.ok && result.snapshot) {
      for (const student of result.snapshot.students || []) {
        const existing = studentsByCode.get(student.code);
        if (existing) {
          // Cùng một mã học sinh ở hai file là lỗi dữ liệu nguồn thật sự: giáo vụ
          // cần biết để sửa. Giữ bản gặp trước để kết quả không đổi giữa các lần chạy.
          duplicates.push({ code: student.code, keptFrom: existing.sourceKey, alsoIn: result.key });
          continue;
        }
        studentsByCode.set(student.code, { ...student, sourceKey: result.key, sourceLabel: result.label });
        source.students += 1;
      }

      for (const guardian of result.snapshot.guardians || []) {
        const current = guardiansByAccount.get(guardian.account);
        if (!current) {
          guardiansByAccount.set(guardian.account, { ...guardian, students: [...(guardian.students || [])] });
          source.guardians += 1;
          continue;
        }
        // Phụ huynh có con ở nhiều cấp: hợp nhất danh sách con thay vì ghi đè.
        for (const link of guardian.students || []) {
          const known = current.students.find((item) => item.studentCode === link.studentCode);
          if (!known) current.students.push({ ...link });
          else if (known.relationship !== link.relationship) known.relationship = "Bố/Mẹ";
        }
        if (!current.displayName && guardian.displayName) current.displayName = guardian.displayName;
      }
    }

    sources.push(source);
  }

  // Bỏ những liên kết trỏ tới học sinh không có trong ảnh chụp (ví dụ dòng bị lỗi
  // đã loại, hoặc mã trùng đã bỏ), để không tạo liên kết mồ côi.
  const guardians = [...guardiansByAccount.values()].map((guardian) => ({
    ...guardian,
    students: guardian.students.filter((link) => studentsByCode.has(link.studentCode)),
  }));

  return {
    snapshot: { students: [...studentsByCode.values()], guardians },
    sources,
    duplicates,
    allSourcesLoaded: sources.length > 0 && sources.every((source) => source.ok),
    scannedRows: sources.reduce((total, source) => total + source.scannedRows, 0),
  };
}

/**
 * Chặn đúng tình huống nguy hiểm nhất: một file đọc ra rỗng hoặc thiếu hẳn một
 * mảng lớn — do đổi tên tab, bị gỡ quyền chia sẻ, hay giáo vụ lỡ xóa — kéo theo
 * vô hiệu hóa nhầm hàng loạt học sinh.
 *
 * Phải thỏa CẢ HAI điều kiện mới dừng: tụt quá tỉ lệ VÀ tụt quá một số lượng tuyệt
 * đối. Chỉ xét tỉ lệ là sai với nhóm nhỏ — một em nghỉ trong nhóm ba em đã là 33%,
 * và cấp THPT vài chục em thì vài em chuyển trường sẽ bị chặn oan mỗi lần đồng bộ.
 *
 * @param incoming        số học sinh đọc được từ nguồn
 * @param activeExisting  số học sinh đang hoạt động trong cơ sở dữ liệu
 * @param maxShrinkRatio  tỉ lệ tụt tối đa còn chấp nhận được
 * @param minShrinkCount  số học sinh biến mất tối thiểu để coi là bất thường
 */
export function checkSnapshotSanity({ incoming, activeExisting, maxShrinkRatio = 0.2, minShrinkCount = 10 }) {
  if (activeExisting === 0) return { ok: true, shrinkRatio: 0, missing: 0 };
  const missing = Math.max(0, activeExisting - incoming);
  const shrinkRatio = missing / activeExisting;
  if (shrinkRatio > maxShrinkRatio && missing >= minShrinkCount) {
    throw mergeError(
      "DIRECTORY_SNAPSHOT_SHRANK",
      `Danh sách đọc từ Google Sheets chỉ còn ${incoming} học sinh, trong khi hệ thống đang có ${activeExisting}`
      + ` (thiếu ${missing} em, giảm ${Math.round(shrinkRatio * 100)}%). Đồng bộ đã dừng để không vô hiệu hóa nhầm hàng loạt.`
      + " Hãy kiểm tra lại 3 file nguồn rồi chạy lại.",
      { incoming, activeExisting, missing, shrinkRatio },
    );
  }
  return { ok: true, shrinkRatio, missing };
}
