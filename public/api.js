const pending = new Set();
export async function waitForPendingRequests() {
  while (pending.size) await Promise.allSettled([...pending]);
}
export function api(path, body, csrf) {
  const request = send(path, body, csrf);
  pending.add(request);
  request.then(() => pending.delete(request), () => pending.delete(request));
  return request;
}
async function send(path, body, csrf) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials:'same-origin', signal:AbortSignal.timeout(15000), headers:{'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrf}:{})}, ...(body===undefined?{}:{body:JSON.stringify(body)}) });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'No se pudo completar la solicitud.');
  return result;
}
