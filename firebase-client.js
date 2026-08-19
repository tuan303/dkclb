import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-analytics.js";

// Firebase Web config là mã nhận diện công khai, không phải khóa ghi dữ liệu quản trị.
export const firebaseConfig = {
  apiKey: "AIzaSyAao0IePGTgeSShHpCXZL_8JGBY9ZuvEkk",
  authDomain: "dkclb-2626f.firebaseapp.com",
  projectId: "dkclb-2626f",
  storageBucket: "dkclb-2626f.firebasestorage.app",
  messagingSenderId: "810121949696",
  appId: "1:810121949696:web:1585274cd919905457dee5",
  measurementId: "G-CLX38QR9KC",
};

const firebaseApp = initializeApp(firebaseConfig);
window.NSHM_FIREBASE_APP = firebaseApp;

isSupported()
  .then((supported) => {
    if (supported) getAnalytics(firebaseApp);
  })
  .catch(() => {
    // Analytics là tùy chọn; không làm gián đoạn luồng đăng ký khi bị chặn mạng/cookie.
  });
