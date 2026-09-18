export const formatDate = (value) => {
  if (!value) return '';
  const text = String(value).slice(0, 10);
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(value);
};

export const todayIso = () => new Date().toISOString().slice(0, 10);
