-- Schema MySQL cho NSHM Clubs. Yêu cầu MySQL 8.0 trở lên (dùng kiểu JSON và CTE).
--
-- Hai quyết định thiết kế cần nói rõ:
--
-- 1) Mọi mốc thời gian lưu dạng chuỗi ISO 8601 UTC (VARCHAR) chứ không dùng DATETIME.
--    Toàn bộ nghiệp vụ đang so sánh thời gian bằng so sánh chuỗi (hạn đóng đợt, hạn
--    phiên đăng nhập, khóa tạm 15 phút). Giữ nguyên kiểu chuỗi thì hành vi giống hệt
--    các nền lưu trữ khác và không phát sinh lỗi lệch múi giờ khi đổi cấu hình máy chủ.
--
-- 2) Không có bảng đếm chỗ riêng. Firestore cần bảng đếm vì không truy vấn tổng hợp
--    được trong giao dịch; MySQL khóa được dòng lớp bằng SELECT ... FOR UPDATE rồi
--    đếm trực tiếp, nên số chỗ luôn khớp với dữ liệu thật, không thể lệch.
--
-- 3) Các cột chứa thông tin cá nhân được ứng dụng mã hóa trước khi ghi, nên trong
--    cơ sở dữ liệu chúng là chuỗi vô nghĩa. Vì mỗi lần mã hóa dùng IV ngẫu nhiên,
--    không thể tra cứu trực tiếp trên các cột đó; việc tra cứu đi qua các cột
--    *_index chứa chỉ mục mù HMAC, cố định theo giá trị nhưng không suy ngược được.
--    Cột mã hóa rộng hơn hẳn bản rõ vì mang thêm IV, thẻ xác thực và phần base64.

CREATE TABLE IF NOT EXISTS users (
  id                    VARCHAR(64)  NOT NULL,
  account               VARCHAR(512) NOT NULL,
  account_index         VARCHAR(190) NOT NULL,
  display_name          VARCHAR(768) NOT NULL,
  role                  VARCHAR(16)  NOT NULL,
  password_salt         VARCHAR(64)      NULL,
  password_hash         VARCHAR(191)     NULL,
  auth_provider         VARCHAR(24)  NOT NULL DEFAULT 'local',
  microsoft_object_id   VARCHAR(64)      NULL,
  must_change_password  TINYINT(1)   NOT NULL DEFAULT 0,
  login_failures        INT          NOT NULL DEFAULT 0,
  locked_until          VARCHAR(32)      NULL,
  active                TINYINT(1)   NOT NULL DEFAULT 1,
  created_at            VARCHAR(32)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_account_index (account_index),
  UNIQUE KEY uk_users_microsoft_object_id (microsoft_object_id),
  KEY idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS students (
  id            VARCHAR(64)  NOT NULL,
  code          VARCHAR(512) NOT NULL,
  code_index    VARCHAR(190) NOT NULL,
  name          VARCHAR(768) NOT NULL,
  date_of_birth VARCHAR(256)     NULL,
  grade         INT          NOT NULL,
  homeroom      VARCHAR(64)  NOT NULL,
  level         VARCHAR(64)  NOT NULL,
  status        VARCHAR(24)  NOT NULL DEFAULT 'active',
  PRIMARY KEY (id),
  UNIQUE KEY uk_students_code_index (code_index),
  KEY idx_students_grade (grade)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS parent_students (
  parent_user_id VARCHAR(64) NOT NULL,
  student_id     VARCHAR(64) NOT NULL,
  relationship   VARCHAR(32) NOT NULL,
  PRIMARY KEY (parent_user_id, student_id),
  KEY idx_parent_students_student (student_id),
  CONSTRAINT fk_parent_students_user    FOREIGN KEY (parent_user_id) REFERENCES users(id)    ON DELETE CASCADE,
  CONSTRAINT fk_parent_students_student FOREIGN KEY (student_id)     REFERENCES students(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS registration_periods (
  id                       VARCHAR(64)  NOT NULL,
  name                     VARCHAR(190) NOT NULL,
  school_year              VARCHAR(32)  NOT NULL,
  term                     VARCHAR(64)  NOT NULL,
  open_at                  VARCHAR(32)  NOT NULL,
  close_at                 VARCHAR(32)  NOT NULL,
  status                   VARCHAR(16)  NOT NULL,
  max_clubs_per_student    INT          NOT NULL DEFAULT 3,
  note                     VARCHAR(500)     NULL,
  updated_at               VARCHAR(32)      NULL,
  PRIMARY KEY (id),
  KEY idx_periods_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS clubs (
  id          VARCHAR(64)  NOT NULL,
  code        VARCHAR(64)  NOT NULL,
  name        VARCHAR(190) NOT NULL,
  category    VARCHAR(64)  NOT NULL,
  description TEXT             NULL,
  emoji       VARCHAR(16)      NULL,
  visual      VARCHAR(16)  NOT NULL DEFAULT 'life',
  grades      JSON         NOT NULL,
  sort_order  INT          NOT NULL DEFAULT 0,
  active      TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uk_clubs_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS club_classes (
  id              VARCHAR(64)  NOT NULL,
  club_id         VARCHAR(64)  NOT NULL,
  period_id       VARCHAR(64)  NOT NULL,
  name            VARCHAR(120) NOT NULL DEFAULT '',
  day_of_week     TINYINT      NOT NULL,
  start_time      CHAR(5)      NOT NULL,
  end_time        CHAR(5)      NOT NULL,
  schedule_label  VARCHAR(120) NOT NULL,
  grades          JSON         NOT NULL,
  room            VARCHAR(120) NOT NULL,
  teacher         VARCHAR(160) NOT NULL,
  capacity        INT          NOT NULL,
  min_capacity    INT          NOT NULL DEFAULT 0,
  enrolled_base   INT          NOT NULL DEFAULT 0,
  fee             INT          NOT NULL DEFAULT 0,
  waitlist_enabled TINYINT(1)  NOT NULL DEFAULT 1,
  sort_order      INT          NOT NULL DEFAULT 0,
  active          TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  KEY idx_club_classes_club (club_id),
  KEY idx_club_classes_period (period_id),
  CONSTRAINT fk_club_classes_club   FOREIGN KEY (club_id)   REFERENCES clubs(id),
  CONSTRAINT fk_club_classes_period FOREIGN KEY (period_id) REFERENCES registration_periods(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS registrations (
  id                VARCHAR(64)  NOT NULL,
  group_id          VARCHAR(64)  NOT NULL,
  student_id        VARCHAR(64)  NOT NULL,
  parent_user_id    VARCHAR(64)      NULL,
  class_id          VARCHAR(64)  NOT NULL,
  period_id         VARCHAR(64)      NULL,
  status            VARCHAR(24)  NOT NULL,
  fee_snapshot      INT          NOT NULL DEFAULT 0,
  schedule_snapshot VARCHAR(120) NOT NULL,
  terms_accepted_at VARCHAR(32)      NULL,
  created_at        VARCHAR(32)  NOT NULL,
  updated_at        VARCHAR(32)  NOT NULL,
  PRIMARY KEY (id),
  KEY idx_registrations_student (student_id),
  KEY idx_registrations_class (class_id),
  KEY idx_registrations_parent (parent_user_id),
  KEY idx_registrations_period (period_id),
  KEY idx_registrations_status (status),
  CONSTRAINT fk_registrations_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_registrations_class   FOREIGN KEY (class_id)   REFERENCES club_classes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS support_requests (
  id              VARCHAR(64) NOT NULL,
  parent_user_id  VARCHAR(64) NOT NULL,
  registration_id VARCHAR(64)     NULL,
  topic           VARCHAR(190) NOT NULL,
  message         TEXT        NOT NULL,
  status          VARCHAR(24) NOT NULL DEFAULT 'open',
  created_at      VARCHAR(32) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_support_parent (parent_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  token      CHAR(64)    NOT NULL,
  user_id    VARCHAR(64) NOT NULL,
  expires_at VARCHAR(32) NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  PRIMARY KEY (token),
  KEY idx_sessions_user (user_id),
  KEY idx_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS oauth_states (
  state         VARCHAR(128) NOT NULL,
  nonce         VARCHAR(128) NOT NULL,
  code_verifier VARCHAR(190) NOT NULL,
  expires_at    VARCHAR(32)  NOT NULL,
  created_at    VARCHAR(32)  NOT NULL,
  PRIMARY KEY (state),
  KEY idx_oauth_states_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id            VARCHAR(64)  NOT NULL,
  actor_user_id VARCHAR(64)      NULL,
  action        VARCHAR(64)  NOT NULL,
  entity_type   VARCHAR(64)  NOT NULL,
  entity_id     VARCHAR(128) NOT NULL,
  before_json   JSON             NULL,
  after_json    JSON             NULL,
  reason        VARCHAR(500)     NULL,
  created_at    VARCHAR(32)  NOT NULL,
  PRIMARY KEY (id),
  KEY idx_audit_action (action),
  KEY idx_audit_entity (entity_type, entity_id),
  KEY idx_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
