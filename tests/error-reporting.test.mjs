import test from "node:test";
import assert from "node:assert/strict";
import { classifyInternalError, toErrorResponse } from "../error-reporting.mjs";

// Nguyên văn lỗi Firestore đã từng lọt ra tận màn hình đăng nhập của phụ huynh.
const FIRESTORE_QUOTA_ERROR = Object.assign(new Error(
  '{ "error": { "code": 429, "message": "Quota exceeded.", "errors": [ { "message": "Quota exceeded.", "domain": "global", "reason": "rateLimitExceeded" } ], "status": "RESOURCE_EXHAUSTED" } }',
), { status: 429 });

test("lỗi hạ tầng không bao giờ lọt nguyên văn ra ngoài", () => {
  const response = toErrorResponse(FIRESTORE_QUOTA_ERROR);
  const serialized = JSON.stringify(response.body);
  assert.ok(!serialized.includes("rateLimitExceeded"), "không được lộ chi tiết kỹ thuật của Google");
  assert.ok(!serialized.includes("RESOURCE_EXHAUSTED"));
  assert.ok(!serialized.includes("Quota exceeded."));
  assert.equal(response.status, 503);
  assert.equal(response.body.error.code, "DATASTORE_QUOTA_EXCEEDED");
  assert.match(response.body.error.message, /hạn ngạch/);
  assert.equal(response.logWorthy, true);
});

test("mã trạng thái của lỗi hạ tầng không được dùng làm mã trả về", () => {
  // Lỗi mang sẵn status 429 nhưng không phải lỗi nghiệp vụ của hệ thống này.
  assert.equal(toErrorResponse(FIRESTORE_QUOTA_ERROR).status, 503);
  const raw = Object.assign(new Error("connect ETIMEDOUT 142.250.66.10:443"), { status: 500 });
  assert.equal(toErrorResponse(raw).body.error.code, "DATASTORE_UNAVAILABLE");
});

test("lỗi nghiệp vụ của hệ thống vẫn hiển thị nguyên văn cho người dùng", () => {
  const business = Object.assign(new Error("Mỗi học sinh được đăng ký tối đa 3 CLB trong đợt này."), {
    status: 422, code: "MAX_CLUBS", expose: true, details: [{ type: "limit" }],
  });
  const response = toErrorResponse(business);
  assert.equal(response.status, 422);
  assert.equal(response.body.error.code, "MAX_CLUBS");
  assert.equal(response.body.error.message, "Mỗi học sinh được đăng ký tối đa 3 CLB trong đợt này.");
  assert.deepEqual(response.body.error.details, [{ type: "limit" }]);
  assert.equal(response.logWorthy, false, "lỗi nghiệp vụ không cần ghi log như sự cố");
});

test("nhận diện đúng nhóm lỗi hạ tầng thường gặp", () => {
  assert.equal(classifyInternalError({ code: 8, message: "8 RESOURCE_EXHAUSTED: Quota exceeded." }).code, "DATASTORE_QUOTA_EXCEEDED");
  assert.equal(classifyInternalError({ code: 7, message: "7 PERMISSION_DENIED: Missing or insufficient permissions." }).code, "DATASTORE_PERMISSION_DENIED");
  assert.equal(classifyInternalError({ code: 14, message: "14 UNAVAILABLE: No connection established" }).code, "DATASTORE_UNAVAILABLE");
  assert.equal(classifyInternalError(new Error("Cannot read properties of undefined")).code, "INTERNAL_ERROR");
  assert.equal(classifyInternalError(undefined).code, "INTERNAL_ERROR");
});

test("đọc được cả nguyên nhân lồng bên trong", () => {
  const wrapped = new Error("Không thể kết nối Cloud Firestore của dự án dkclb-2626f.", {
    cause: Object.assign(new Error("Quota exceeded."), { code: "RESOURCE_EXHAUSTED" }),
  });
  assert.equal(classifyInternalError(wrapped).code, "DATASTORE_QUOTA_EXCEEDED");
});
