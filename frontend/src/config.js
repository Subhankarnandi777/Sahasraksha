// Judges hitting the deployed link don't have time to sign up, so the
// login/signup gate is off by default -- every route lands straight on its
// page. Flip VITE_REQUIRE_AUTH=true (and redeploy) to turn the gate back on;
// /login and /signup still work if visited directly either way.
export const AUTH_REQUIRED = import.meta.env.VITE_REQUIRE_AUTH === "true";
