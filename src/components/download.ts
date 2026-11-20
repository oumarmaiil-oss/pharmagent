// Téléchargement authentifié : le jeton part dans l'en-tête, jamais dans l'adresse (historique, journaux, Referer)
export async function downloadWithAuth(url: string, token: string, fallbackName: string): Promise<void> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Téléchargement impossible.');
  const name = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName;
  const href = URL.createObjectURL(await r.blob());
  const a = document.createElement('a');
  a.href = href; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
