// Run work after the response has been sent, without making the user wait.
// On Vercel this uses the request context's waitUntil() (the same thing
// @vercel/functions' waitUntil does; we avoid that package's ~20 extra
// dependencies). If it is not available on Vercel, the work is done before
// responding instead (slower, but never lost). Locally (express) the process
// stays alive, so the work simply runs in the background.
// Errors must be handled inside task(); they are only logged here.
async function afterResponse(task) {
  const run = () => Promise.resolve().then(task).catch((e) => console.error("background task:", e.message));
  const ctx = globalThis[Symbol.for("@vercel/request-context")]?.get?.();
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(run());
    return "background";
  }
  if (process.env.VERCEL) {
    await run();
    return "inline";
  }
  run();
  return "background";
}

module.exports = { afterResponse };
