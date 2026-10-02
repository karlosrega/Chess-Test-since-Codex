export async function api(path, body, csrf) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials:'same-origin', headers:{'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrf}:{})}, ...(body===undefined?{}:{body:JSON.stringify(body)}) });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'No se pudo completar la solicitud.');
  return result;
}
