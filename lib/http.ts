const allowedOrigins = [
  /^https:\/\/adam-urlopometr\.jakiesluchawki\.chatgpt\.site$/,
  /^https:\/\/jakiesluchawki\.github\.io$/,
  /^https:\/\/jakiesluchawki\.github\.io\/urlopometr\/?$/,
  /^http:\/\/terminal\.local(?::\d+)?$/,
  /^http:\/\/localhost(?::\d+)?$/,
];

export function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  const allowed = allowedOrigins.some((pattern) => pattern.test(origin));
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://adam-urlopometr.jakiesluchawki.chatgpt.site",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    Vary: "Origin",
    "Cache-Control": "no-store",
  };
}

export function json(request: Request, body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders(request) });
}

