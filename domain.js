export function minutes(value) {
  if (typeof value !== 'string' || !/^\d{2}:[0-5]\d$/.test(value)) return null;
  const [h, m] = value.split(':').map(Number);
  const total = h * 60 + m;
  return total > 0 && total <= 24 * 60 ? total : null;
}

export function clock(value) {
  return `${Math.floor(value / 60).toString().padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`;
}

export function validatePrediction(items, runners) {
  if (runners.length < 2) return 'Il faut au moins deux coureurs pour pronostiquer.';
  if (!Array.isArray(items) || items.length !== runners.length) return 'Classe tous les coureurs et indique un temps pour chacun.';
  const ids = new Set(runners.map(r => r.id));
  for (const item of items) {
    if (!item || !ids.delete(item.runnerId) || minutes(item.time) === null) return 'Coureur en double, inconnu ou temps invalide (HH:mm, de 00:01 à 24:00).';
  }
  return null;
}

export function scorePrediction(items, runners) {
  const finished = runners.filter(r => r.status === 'finished').sort((a,b) => a.result_position - b.result_position);
  if (!finished.length || runners.some(r => r.status === 'pending')) return null;
  const positions = new Map(finished.map((r, i) => [r.id, i + 1]));
  const last = finished.length + 1;
  const position = items.reduce((sum, item, i) => sum + Math.abs(i + 1 - (positions.get(item.runnerId) ?? last)), 0);
  const times = new Map(finished.map(r => [r.id, r.result_minutes]));
  const time = items.reduce((sum, item) => sum + (times.has(item.runnerId) ? Math.abs(item.minutes - times.get(item.runnerId)) : 0), 0) / finished.length;
  return { position, time };
}

export function ranked(entries, key) {
  const sorted = [...entries].sort((a,b) => a[key] - b[key] || a.username.localeCompare(b.username, 'fr'));
  let rank = 0;
  return sorted.map((entry, i) => {
    if (i === 0 || entry[key] !== sorted[i-1][key]) rank = i + 1;
    return { ...entry, rank };
  });
}
