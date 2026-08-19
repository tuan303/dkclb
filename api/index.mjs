import { handleRequest } from "../server.mjs";

export default async function handler(request, response) {
  const url = new URL(request.url || "/", `https://${request.headers.host || "localhost"}`);
  const routedPath = url.searchParams.get("__path");
  if (routedPath !== null) {
    url.searchParams.delete("__path");
    request.url = `/api/${routedPath}${url.search}`;
  }
  return handleRequest(request, response);
}
