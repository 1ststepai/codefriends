import type { Request as ExpressRequest, Response as ExpressResponse } from "express";

export function expressToFetch(req: ExpressRequest): Request {
  const host = req.get("host") ?? "127.0.0.1";
  const proto = req.protocol || "http";
  const url = `${proto}://${host}${req.originalUrl}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  const method = req.method.toUpperCase();
  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD" && req.body !== undefined) {
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    init.body = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
  }
  return new Request(url, init);
}

export async function sendFetchResponse(res: ExpressResponse, response: Response): Promise<void> {
  res.status(response.status);
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (location) {
      res.redirect(response.status, location);
      return;
    }
  }
  const buf = Buffer.from(await response.arrayBuffer());
  if (buf.length === 0) {
    res.end();
    return;
  }
  res.send(buf);
}
