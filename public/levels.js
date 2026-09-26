// The JSON block with id="level-config" in index.html is the editable source.
export const DEFAULT_LEVEL = Object.freeze({ id: 1, startSpeed: 2, endSpeed: 6, duration: 360 });

export function validateLevels(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 30) throw new Error('Неверный список уровней.');
  return raw.map((entry, index) => {
    const { id, startSpeed, endSpeed, duration } = entry || {};
    if (id !== index + 1 || !Number.isFinite(startSpeed) || !Number.isFinite(endSpeed)
      || startSpeed < .5 || endSpeed < startSpeed || endSpeed > 20
      || !Number.isInteger(duration) || duration < 240 || duration > 1800 || duration % 60 !== 0)
      throw new Error(`Неверные настройки уровня ${index + 1}.`);
    return { id, startSpeed, endSpeed, duration };
  });
}

export function levelsFromHtml(html) {
  const match = html.match(/<script\s+id="level-config"\s+type="application\/json"\s*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('В index.html отсутствует level-config.');
  return validateLevels(JSON.parse(match[1]));
}
