// Admin site settings (not secret).
// liffId: a second LIFF app in the same LINE Login channel as the user web app,
//         with this site's URL as its endpoint.
// apiBase: the backend API (admin endpoints allow this site's origin via CORS).
window.ADMIN_CONFIG = {
  liffId: "",
  apiBase: "https://bot-backend-three.vercel.app/api",
};
